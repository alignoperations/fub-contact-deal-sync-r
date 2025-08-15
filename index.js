// FUB Contact-to-Deal Sync Automation
// Handles creating, updating, and deleting deals based on contact stage changes
// Converts email notifications to Slack DMs

const axios = require('axios');
const express = require('express');
const app = express();

// Configuration - Updated to use environment variables
const CONFIG = {
  FUB_API_KEY: process.env.FOLLOWUPBOSS_API_KEY || process.env.FUB_API_KEY,
  SLACK_BOT_TOKEN: process.env.SLACK_BOT_TOKEN,
  SLACK_OPERATIONS_USER_ID: process.env.SLACK_OPERATIONS_USER_ID,
  SLACK_OWNER_USER_ID: process.env.SLACK_OWNER_USER_ID,
  SLACK_NOTIFICATIONS_CHANNEL_ID: process.env.SLACK_NOTIFICATIONS_CHANNEL_ID,
  ASANA_ACCESS_TOKEN: process.env.ASANA_ACCESS_TOKEN,
  ASANA_PROJECT_ID: process.env.ASANA_PROJECT_ID,
  ASANA_ASSIGNEE_GID: process.env.ASANA_ASSIGNEE_GID,
  FUB_BASE_URL: 'https://api.followupboss.com/v1',
  PORT: process.env.PORT || 3000,
  COMMERCIAL_PIPELINE_ID: null
};

// Middleware
app.use(express.json());

// In-memory deduplication store
const processedEvents = new Map();

// Clean up old events every 5 minutes
setInterval(() => {
  const fiveMinutesAgo = Date.now() - (5 * 60 * 1000);
  for (const [eventId, timestamp] of processedEvents.entries()) {
    if (timestamp < fiveMinutesAgo) {
      processedEvents.delete(eventId);
    }
  }
}, 5 * 60 * 1000);
// FUB API Helper with Basic Auth
const fubAPI = {
  get headers() {
    return {
      'Authorization': `Basic ${Buffer.from(`${CONFIG.FUB_API_KEY}:`).toString('base64')}`,
      'Content-Type': 'application/json',
      'X-System': 'ManifestNetwork'
    };
  },

  async get(endpoint) {
    const response = await axios.get(`${CONFIG.FUB_BASE_URL}${endpoint}`, {
      headers: this.headers
    });
    return response.data;
  },

  async post(endpoint, data) {
    const response = await axios.post(`${CONFIG.FUB_BASE_URL}${endpoint}`, data, {
      headers: this.headers
    });
    return response.data;
  },

  async put(endpoint, data) {
    const response = await axios.put(`${CONFIG.FUB_BASE_URL}${endpoint}`, data, {
      headers: this.headers
    });
    return response.data;
  },

  async delete(endpoint) {
    const response = await axios.delete(`${CONFIG.FUB_BASE_URL}${endpoint}`, {
      headers: this.headers
    });
    return response.data;
  }
};

// Updated Slack API Helper
const slackAPI = {
  async sendDM(userId, message) {
    try {
      const response = await axios.post('https://slack.com/api/chat.postMessage', {
        channel: userId,
        text: message
      }, {
        headers: {
          'Authorization': `Bearer ${CONFIG.SLACK_BOT_TOKEN}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.data.ok) {
        throw new Error(`Slack API error: ${response.data.error}`);
      }

      console.log(`✅ Slack DM sent to ${userId}`);
      return response.data;
    } catch (error) {
      console.error(`❌ Failed to send Slack DM to ${userId}:`, error.message);
      throw error;
    }
  },

  async sendChannelMessage(channelId, message) {
    try {
      const response = await axios.post('https://slack.com/api/chat.postMessage', {
        channel: channelId,
        text: message
      }, {
        headers: {
          'Authorization': `Bearer ${CONFIG.SLACK_BOT_TOKEN}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.data.ok) {
        throw new Error(`Slack API error: ${response.data.error}`);
      }

      console.log(`✅ Slack message sent to channel ${channelId}`);
      return response.data;
    } catch (error) {
      console.error(`❌ Failed to send Slack message to channel ${channelId}:`, error.message);
      throw error;
    }
  }
};

// Updated Asana API Helper
const asanaAPI = {
  async createTask(title, description, assigneeGid = CONFIG.ASANA_ASSIGNEE_GID) {
    try {
      const taskData = {
        data: {
          name: title,
          notes: description,
          projects: [CONFIG.ASANA_PROJECT_ID]
        }
      };

      if (assigneeGid) {
        taskData.data.assignee = assigneeGid;
      }

      const response = await axios.post('https://app.asana.com/api/1.0/tasks', taskData, {
        headers: {
          'Authorization': `Bearer ${CONFIG.ASANA_ACCESS_TOKEN}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        }
      });
      
      console.log(`✅ Created Asana task: ${response.data.data.gid}`);
      return response.data;
    } catch (error) {
      console.error('❌ Asana API error:', {
        status: error.response?.status,
        statusText: error.response?.statusText,
        data: error.response?.data,
        message: error.message
      });
      throw error;
    }
  },

  async testConnection() {
    try {
      const response = await axios.get('https://app.asana.com/api/1.0/users/me', {
        headers: {
          'Authorization': `Bearer ${CONFIG.ASANA_ACCESS_TOKEN}`,
          'Accept': 'application/json'
        }
      });
      
      console.log('✅ Asana connection successful:', response.data.data.name);
      return true;
    } catch (error) {
      console.error('❌ Asana connection failed:', error.response?.data || error.message);
      return false;
    }
  }
};
// Check if deal should be counted as "active" (not protected/closed)
const isDealActive = (deal) => {
  const dealStage = normalize(deal.stage || '');
  
  if (dealStage.includes('closed')) {
    return false;
  }
  
  if (STAGE_MAPPING.protectedStages.some(stage => 
    dealStage.includes(normalize(stage)))) {
    return false;
  }
  
  return true;
};

// Enhanced Stage mapping configuration
const STAGE_MAPPING = {
  protectedStages: [
    "offer rejected", "client not taken", "working with another agent", 
    "fall through", "expired", "cancelled", "listing agreement", 
    "pre-listing", "active listing", "active off-market", 
    "application accepted", "attorney review", "under contract", 
    "showing homes", "offers submitted", "submitting applications"
  ],
  
  protectedPipelines: [
    "agent recruiting", "outgoing referral"
  ],
  
  deletionStages: [
    "lead", "attempted contact", "spoke with customer", "unresponsive", "nurture"
  ]
};

// Pipeline tag mapping (Commercial excluded from tag detection)
const PIPELINE_MAPPING = {
  'Seller': 2,
  'Buyer': 1,
  'Landlord': 3,
  'Tenant': 4,
  'Listing': 2
};

// Utility functions
const normalize = (str) => (str || "").trim().toLowerCase();

const extractPipelineFromTags = (tags) => {
  if (!tags || !Array.isArray(tags)) return [];
  
  const pipelineTags = [];
  const tagStr = tags.join(' ').toLowerCase();
  
  Object.keys(PIPELINE_MAPPING).forEach(pipeline => {
    if (tagStr.includes(pipeline.toLowerCase())) {
      pipelineTags.push(pipeline);
    }
  });
  
  return [...new Set(pipelineTags)];
};

const shouldDeleteDeal = (deal, contactStage, availableStageNames) => {
  const dealStage = normalize(deal.stage || '');
  const pipelineName = normalize(deal.pipelineName || '');
  let updatedStage = normalize(contactStage);
  
  if (contactStage.toLowerCase().startsWith('commercial - ')) {
    updatedStage = normalize(contactStage.substring(13));
  }
  
  if (STAGE_MAPPING.protectedPipelines.some(pipeline => 
    pipelineName.includes(normalize(pipeline)))) {
    console.log(`🛡️ Deal ${deal.id} in protected pipeline: ${pipelineName}`);
    return false;
  }
  
  if (dealStage.includes('closed')) {
    console.log(`🛡️ Deal ${deal.id} is closed: ${dealStage}`);
    return false;
  }
  
  if (STAGE_MAPPING.protectedStages.some(stage => 
    dealStage.includes(normalize(stage)))) {
    console.log(`🛡️ Deal ${deal.id} in protected stage: ${dealStage}`);
    return false;
  }
  
  if (STAGE_MAPPING.deletionStages.includes(updatedStage)) {
    console.log(`🗑️ Deal ${deal.id} marked for deletion: contact in deletion stage "${updatedStage}"`);
    return true;
  }
  
  const normalizedAvailableStages = availableStageNames.map(normalize);
  if (!normalizedAvailableStages.includes(updatedStage)) {
    console.log(`🗑️ Deal ${deal.id} marked for deletion: contact stage "${updatedStage}" not found in pipeline stages`);
    return true;
  }
  
  console.log(`✅ Deal ${deal.id} kept: stage "${updatedStage}" found in pipeline`);
  return false;
};

const findStageId = (inputData) => {
  const { stageName, stageNames, stageIds, dealID } = inputData;
  
  const inputName = normalize(stageName);
  const namesArray = (stageNames || "").split(',').map(name => name.trim().toLowerCase());
  const idsArray = (stageIds || "").split(',').map(id => id.trim());
  const dealIdsArray = (dealID || "").split(',').map(id => id.trim()).filter(Boolean);
  
  const index = namesArray.indexOf(inputName);
  const matchedId = index !== -1 ? idsArray[index] : "0";
  
  console.log(`🎯 Stage mapping: "${inputName}" → Stage ID: ${matchedId}`);
  
  let shouldCreateDeal = "no";
  let shouldUpdateDeal = "no";
  let skipUpdate = "no";
  
  if (dealIdsArray.length === 0) {
    shouldCreateDeal = "yes";
    console.log(`✅ Decision: CREATE (no existing deals)`);
  } else if (dealIdsArray.length > 1) {
    skipUpdate = "yes";
    console.log(`⚠️ Decision: SKIP (multiple deals: ${dealIdsArray.length})`);
  } else {
    if (matchedId === "0") {
      console.log(`❌ Decision: ERROR (stage not found in pipeline)`);
    } else {
      shouldUpdateDeal = "yes";
      console.log(`🔄 Decision: UPDATE (one deal exists, stage found)`);
    }
  }
  
  return {
    stageId: matchedId,
    shouldCreateDeal,
    shouldUpdateDeal,
    skipUpdate
  };
};

const formatStageForBuyer = (pipelineName, stageName) => {
  return stageName;
};

const formatStageForCommercial = (contactStage) => {
  if (contactStage.toLowerCase().startsWith('commercial - ')) {
    return contactStage.substring(13);
  }
  return contactStage;
};
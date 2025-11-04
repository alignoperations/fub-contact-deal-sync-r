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

// Environment variable validation
function validateEnvironmentVariables() {
  const required = {
    FUB_API_KEY: CONFIG.FUB_API_KEY,
    SLACK_BOT_TOKEN: CONFIG.SLACK_BOT_TOKEN,
    SLACK_NOTIFICATIONS_CHANNEL_ID: CONFIG.SLACK_NOTIFICATIONS_CHANNEL_ID,
    ASANA_ACCESS_TOKEN: CONFIG.ASANA_ACCESS_TOKEN,
    ASANA_PROJECT_ID: CONFIG.ASANA_PROJECT_ID,
    ASANA_ASSIGNEE_GID: CONFIG.ASANA_ASSIGNEE_GID
  };

  const missing = [];
  const warnings = [];

  for (const [key, value] of Object.entries(required)) {
    if (!value) {
      missing.push(key);
    }
  }

  // Optional but recommended variables
  if (!CONFIG.SLACK_OPERATIONS_USER_ID) {
    warnings.push('SLACK_OPERATIONS_USER_ID');
  }
  if (!CONFIG.SLACK_OWNER_USER_ID) {
    warnings.push('SLACK_OWNER_USER_ID');
  }

  if (missing.length > 0) {
    console.error('ERROR: Missing required environment variables:');
    missing.forEach(key => console.error(`  - ${key}`));
    console.error('\nThe application cannot start without these variables.');
    process.exit(1);
  }

  if (warnings.length > 0) {
    console.warn('WARNING: Optional environment variables not set:');
    warnings.forEach(key => console.warn(`  - ${key}`));
    console.warn('Some features may not work as expected.\n');
  }

  console.log('SUCCESS: All required environment variables are set');
}

// Run validation immediately
validateEnvironmentVariables();

// Middleware
app.use(express.json());

// In-memory deduplication store
const processedEvents = new Map();

// Clean up old events every 5 minutes
const cleanupInterval = setInterval(() => {
  const fiveMinutesAgo = Date.now() - (5 * 60 * 1000);
  for (const [eventId, timestamp] of processedEvents.entries()) {
    if (timestamp < fiveMinutesAgo) {
      processedEvents.delete(eventId);
    }
  }
}, 5 * 60 * 1000);

// Graceful shutdown
process.on('SIGTERM', () => {
  clearInterval(cleanupInterval);
  process.exit(0);
});

process.on('SIGINT', () => {
  clearInterval(cleanupInterval);
  process.exit(0);
});

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
    try {
      const response = await axios.get(`${CONFIG.FUB_BASE_URL}${endpoint}`, {
        headers: this.headers,
        timeout: 15000
      });
      return response.data;
    } catch (error) {
      const errorDetails = {
        endpoint,
        status: error.response?.status,
        statusText: error.response?.statusText,
        message: error.message,
        data: error.response?.data
      };
      console.error(`FUB API GET error for ${endpoint}:`, errorDetails);
      throw new Error(`FUB API GET failed: ${error.message} (${endpoint})`);
    }
  },

  async post(endpoint, data) {
    try {
      const response = await axios.post(`${CONFIG.FUB_BASE_URL}${endpoint}`, data, {
        headers: this.headers,
        timeout: 15000
      });
      return response.data;
    } catch (error) {
      const errorDetails = {
        endpoint,
        status: error.response?.status,
        statusText: error.response?.statusText,
        message: error.message,
        data: error.response?.data
      };
      console.error(`FUB API POST error for ${endpoint}:`, errorDetails);
      throw new Error(`FUB API POST failed: ${error.message} (${endpoint})`);
    }
  },

  async put(endpoint, data) {
    try {
      const response = await axios.put(`${CONFIG.FUB_BASE_URL}${endpoint}`, data, {
        headers: this.headers,
        timeout: 15000
      });
      return response.data;
    } catch (error) {
      const errorDetails = {
        endpoint,
        status: error.response?.status,
        statusText: error.response?.statusText,
        message: error.message,
        data: error.response?.data
      };
      console.error(`FUB API PUT error for ${endpoint}:`, errorDetails);
      throw new Error(`FUB API PUT failed: ${error.message} (${endpoint})`);
    }
  },

  async delete(endpoint) {
    try {
      const response = await axios.delete(`${CONFIG.FUB_BASE_URL}${endpoint}`, {
        headers: this.headers,
        timeout: 15000
      });
      return response.data;
    } catch (error) {
      const errorDetails = {
        endpoint,
        status: error.response?.status,
        statusText: error.response?.statusText,
        message: error.message,
        data: error.response?.data
      };
      console.error(`FUB API DELETE error for ${endpoint}:`, errorDetails);
      throw new Error(`FUB API DELETE failed: ${error.message} (${endpoint})`);
    }
  }
};

// Updated Slack API Helper
const slackAPI = {
  async sendDM(userId, message) {
    if (!userId) {
      throw new Error('Slack DM failed: userId is required');
    }
    if (!message) {
      throw new Error('Slack DM failed: message is required');
    }

    try {
      const response = await axios.post('https://slack.com/api/chat.postMessage', {
        channel: userId,
        text: message
      }, {
        headers: {
          'Authorization': `Bearer ${CONFIG.SLACK_BOT_TOKEN}`,
          'Content-Type': 'application/json'
        },
        timeout: 10000
      });

      if (!response.data.ok) {
        throw new Error(`Slack API error: ${response.data.error || 'Unknown error'}`);
      }

      console.log(`SUCCESS: Slack DM sent to ${userId}`);
      return response.data;
    } catch (error) {
      const errorDetails = {
        userId,
        status: error.response?.status,
        message: error.message,
        slackError: error.response?.data?.error
      };
      console.error(`FAILED: to send Slack DM to ${userId}:`, errorDetails);
      throw new Error(`Slack DM failed: ${error.message}`);
    }
  },

  async sendChannelMessage(channelId, message) {
    if (!channelId) {
      throw new Error('Slack channel message failed: channelId is required');
    }
    if (!message) {
      throw new Error('Slack channel message failed: message is required');
    }

    try {
      const response = await axios.post('https://slack.com/api/chat.postMessage', {
        channel: channelId,
        text: message
      }, {
        headers: {
          'Authorization': `Bearer ${CONFIG.SLACK_BOT_TOKEN}`,
          'Content-Type': 'application/json'
        },
        timeout: 10000
      });

      if (!response.data.ok) {
        throw new Error(`Slack API error: ${response.data.error || 'Unknown error'}`);
      }

      console.log(`SUCCESS: Slack message sent to channel ${channelId}`);
      return response.data;
    } catch (error) {
      const errorDetails = {
        channelId,
        status: error.response?.status,
        message: error.message,
        slackError: error.response?.data?.error
      };
      console.error(`FAILED: to send Slack message to channel ${channelId}:`, errorDetails);
      throw new Error(`Slack channel message failed: ${error.message}`);
    }
  }
};

// Tag management helpers for loop prevention
const tagHelpers = {
  async hasLoopPreventionTag(personTags) {
    // Check if person has the TriggeredDealContactStageUpdates tag
    if (!personTags || !Array.isArray(personTags)) {
      return false;
    }
    return personTags.some(tag => 
      (typeof tag === 'string' && tag.toLowerCase() === 'triggereddealcontactstageupdates') ||
      (tag.name && tag.name.toLowerCase() === 'triggereddealcontactstageupdates')
    );
  },

  async removeLoopPreventionTag(personId) {
    try {
      console.log('LOOP_PREVENTION: Checking for and removing TriggeredDealContactStageUpdates tag from person:', personId);
      
      // Get person's current tags
      const personData = await fubAPI.get(`/people/${personId}`);
      
      if (!personData.tags || !Array.isArray(personData.tags)) {
        console.log('LOOP_PREVENTION: No tags found on person');
        return false;
      }

      // Find the loop prevention tag
      const loopPreventionTag = personData.tags.find(tag => {
        const tagName = typeof tag === 'string' ? tag : tag.name;
        return tagName && tagName.toLowerCase() === 'triggereddealcontactstageupdates';
      });

      if (!loopPreventionTag) {
        console.log('LOOP_PREVENTION: Tag not found on person');
        return false;
      }

      // Get the tag ID if it's an object, otherwise it's the string name
      const tagToRemove = typeof loopPreventionTag === 'string' ? loopPreventionTag : loopPreventionTag.name;

      // Get all tags except the loop prevention tag
      const remainingTags = personData.tags.filter(tag => {
        const tagName = typeof tag === 'string' ? tag : tag.name;
        return tagName && tagName.toLowerCase() !== 'triggereddealcontactstageupdates';
      }).map(tag => typeof tag === 'string' ? tag : tag.name);

      console.log('LOOP_PREVENTION: Removing tag. Remaining tags:', remainingTags);

      // Update person with remaining tags (this replaces all tags)
      await fubAPI.put(`/people/${personId}`, {
        tags: remainingTags
      });

      console.log('LOOP_PREVENTION: Successfully removed tag from person:', personId);
      return true;
    } catch (error) {
      console.error('LOOP_PREVENTION: Failed to remove tag:', error.message);
      return false;
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
      
      console.log(`SUCCESS: Created Asana task: ${response.data.data.gid}`);
      return response.data;
    } catch (error) {
      console.error('FAILED: Asana API error:', {
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
      
      console.log('SUCCESS: Asana connection successful:', response.data.data.name);
      return true;
    } catch (error) {
      console.error('FAILED: Asana connection failed:', error.response?.data || error.message);
      return false;
    }
  }
};

// Check if deal should be counted as 'active' (not protected/closed)
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
    'offer rejected', 'client not taken', 'working with another agent', 
    'fall through', 'expired', 'cancelled', 'listing agreement', 
    'pre-listing', 'active listing', 'active off-market', 
    'application accepted', 'attorney review', 'under contract', 
    'showing homes', 'offers submitted', 'submitting applications',
    'closed', 'temporarily off market', 'application rejected'  // Enhanced closed protection
  ],
  
  protectedPipelines: [
    'agent recruiting', 'outgoing referral'
  ],
  
  deletionStages: [
    'lead', 'attempted contact', 'spoke with customer'
    // Note: 'trash' is intentionally NOT in deletion stages - it should not trigger deal deletion
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

// Stage mapping for contact stage variations to deal stages
const STAGE_VARIATIONS = {
  'submitting offers': 'offers submitted',
  'referral out open': 'send referral agreement',
  'referral out under contract': 'referral under contract',
  'referral out closed': 'referral closed',
  // Add more mappings as needed
};

// Pipeline-specific stage mappings for contact stages that map to different deal stages based on pipeline
const getPipelineSpecificStage = (contactStage, pipelineTag) => {
  const normalizedContactStage = normalize(contactStage);
  
  // Submitting offers -> different deal stages based on pipeline
  if (normalizedContactStage === 'submitting offers') {
    if (pipelineTag === 'Buyer') {
      return 'Offers Submitted';
    } else if (pipelineTag === 'Tenant') {
      return 'Applications Submitted';
    }
  }
  
  // Under Contract -> different deal stages based on pipeline
  if (normalizedContactStage === 'under contract') {
    if (pipelineTag === 'Tenant' || pipelineTag === 'Landlord') {
      return 'Application Accepted';
    } else if (pipelineTag === 'Buyer' || pipelineTag === 'Listing' || pipelineTag === 'Seller') {
      return 'Under Contract';
    }
  }
  
  return null; // No pipeline-specific mapping
};

// Function to normalize stage names and handle variations
const normalizeStageForComparison = (stageName) => {
  const normalized = normalize(stageName);
  return STAGE_VARIATIONS[normalized] || normalized;
};

// Utility functions
const normalize = (str) => (str || '').trim().toLowerCase();

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
  let updatedStage = normalizeStageForComparison(contactStage);
  
  console.log(`CHECKING: Deal ${deal.id} with stage '${deal.stage}' (normalized: '${dealStage}') against contact stage '${contactStage}' (normalized: '${updatedStage}')`);
  
  if (contactStage.toLowerCase().startsWith('commercial - ')) {
    updatedStage = normalizeStageForComparison(formatStageForCommercial(contactStage));
  }
  
  // Enhanced closed deal detection
  const closedKeywords = ['closed', 'won', 'lost', 'completed', 'finished'];
  const isDealClosed = closedKeywords.some(keyword => dealStage.includes(keyword));
  
  if (STAGE_MAPPING.protectedPipelines.some(pipeline => 
    pipelineName.includes(normalize(pipeline)))) {
    console.log(`PROTECTED: Deal ${deal.id} in protected pipeline: ${pipelineName}`);
    return false;
  }
  
  if (isDealClosed) {
    console.log(`PROTECTED: Deal ${deal.id} is closed/completed: ${dealStage}`);
    return false;
  }
  
  // Enhanced protection check - check both exact match and partial match
  const isProtectedStage = STAGE_MAPPING.protectedStages.some(stage => {
    const normalizedProtectedStage = normalize(stage);
    return dealStage.includes(normalizedProtectedStage) || normalizedProtectedStage.includes(dealStage);
  });
  
  if (isProtectedStage) {
    console.log(`PROTECTED: Deal ${deal.id} in protected stage: '${deal.stage}' (normalized: '${dealStage}')`);
    return false;
  }
  
  // Special protection: never delete deals when contact stage is "trash" 
  // This is a contact management stage, not a deal progression stage
  if (updatedStage === 'trash') {
    console.log(`PROTECTED: Deal ${deal.id} protected from contact 'trash' stage - deals should not be deleted for contact management actions`);
    return false;
  }
  
  if (STAGE_MAPPING.deletionStages.includes(updatedStage)) {
    console.log(`DELETE: Deal ${deal.id} marked for deletion: contact in deletion stage '${updatedStage}'`);
    return true;
  }
  
  // Check if the contact stage (or its mapped equivalent) exists in this deal's pipeline
  const normalizedAvailableStages = availableStageNames.map(normalize);
  const mappedContactStage = normalizeStageForComparison(contactStage);
  
  if (normalizedAvailableStages.includes(normalize(updatedStage)) || 
      normalizedAvailableStages.includes(normalize(mappedContactStage))) {
    console.log(`SUCCESS: Deal ${deal.id} kept: contact stage '${contactStage}' or mapped stage found in pipeline`);
    return false;
  }
  
  console.log(`DELETE: Deal ${deal.id} marked for deletion: contact stage '${contactStage}' (normalized: '${updatedStage}', mapped: '${mappedContactStage}') not found in pipeline stages: [${normalizedAvailableStages.join(', ')}]`);
  return true;
};

const findStageId = (inputData) => {
  const { stageName, stageNames, stageIds, dealID } = inputData;
  
  const inputName = normalizeStageForComparison(stageName);
  const namesArray = (stageNames || '').split(',').map(name => normalize(name.trim()));
  const idsArray = (stageIds || '').split(',').map(id => id.trim());
  const dealIdsArray = (dealID || '').split(',').map(id => id.trim()).filter(Boolean);
  
  // Try exact match first, then check for reverse mapping
  let index = namesArray.indexOf(inputName);
  
  // If no exact match, try to find the deal stage equivalent in the pipeline
  if (index === -1) {
    for (let i = 0; i < namesArray.length; i++) {
      if (normalizeStageForComparison(namesArray[i]) === inputName) {
        index = i;
        break;
      }
    }
  }
  
  const matchedId = index !== -1 ? idsArray[index] : '0';
  
  console.log(`MAPPING: Stage mapping: '${stageName}' -> normalized: '${inputName}' -> Stage ID: ${matchedId}`);
  
  let shouldCreateDeal = 'no';
  let shouldUpdateDeal = 'no';
  let skipUpdate = 'no';
  
  if (dealIdsArray.length === 0) {
    shouldCreateDeal = 'yes';
    console.log(`DECISION: CREATE (no existing deals)`);
  } else if (dealIdsArray.length > 1) {
    skipUpdate = 'yes';
    console.log(`WARNING: SKIP (multiple deals: ${dealIdsArray.length})`);
  } else {
    if (matchedId === '0') {
      console.log(`ERROR: DECISION: ERROR (stage not found in pipeline)`);
    } else {
      shouldUpdateDeal = 'yes';
      console.log(`UPDATE: DECISION: UPDATE (one deal exists, stage found)`);
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

// Helper function to check if a stage exists in any pipeline (i.e., is a valid deal stage)
const isValidDealStage = async (stageName) => {
  try {
    const normalizedStage = normalize(stageName);
    
    // Check if it's a commercial stage
    if (stageName.toLowerCase().startsWith('commercial - ')) {
      const formattedStage = formatStageForCommercial(stageName);
      try {
        const allPipelines = await fubAPI.get('/pipelines');
        const commercialPipeline = allPipelines.pipelines?.find(p => 
          p.name && p.name.toLowerCase().includes('commercial')
        );
        if (commercialPipeline) {
          const pipelineStages = await fubAPI.get(`/pipelines/${commercialPipeline.id}`);
          const stageNames = pipelineStages.stages?.map(s => normalize(s.name)) || [];
          return stageNames.includes(normalize(formattedStage));
        }
      } catch (error) {
        console.error('FAILED: to check commercial pipeline:', error.message);
        return false;
      }
    }
    
    // Check all mapped pipelines
    for (const pipelineId of Object.values(PIPELINE_MAPPING)) {
      try {
        const pipelineStages = await fubAPI.get(`/pipelines/${pipelineId}`);
        const stageNames = pipelineStages.stages?.map(s => normalize(s.name)) || [];
        if (stageNames.includes(normalizedStage)) {
          return true;
        }
      } catch (error) {
        console.error(`FAILED: to check pipeline ${pipelineId}:`, error.message);
      }
    }
    
    return false;
  } catch (error) {
    console.error('FAILED: to validate deal stage:', error.message);
    return false;
  }
};

// Helper function to update existing deal when no pipeline tags detected
const updateExistingDealWithoutPipelineTags = async (deal, contactStage) => {
  try {
    // Get the pipeline stages for this deal's pipeline
    const pipelineStages = await fubAPI.get(`/pipelines/${deal.pipelineId}`);
    
    // Format the stage based on pipeline type
    let formattedStage = contactStage;
    
    // Check if it's a commercial pipeline by name
    const pipelineName = pipelineStages.name || '';
    if (pipelineName.toLowerCase().includes('commercial') && contactStage.toLowerCase().startsWith('commercial - ')) {
      formattedStage = formatStageForCommercial(contactStage);
    }
    
    // Find the stage ID
    const stageResult = findStageId({
      stageName: formattedStage,
      stageNames: pipelineStages.stages?.map(s => s.name).join(',') || '',
      stageIds: pipelineStages.stages?.map(s => s.id).join(',') || '',
      dealID: deal.id.toString()
    });
    
    if (stageResult.stageId === '0') {
      console.log(`ERROR: Stage '${formattedStage}' not found in pipeline ${pipelineName}`);
      return { success: false, reason: 'stage_not_found', pipeline: pipelineName, stage: formattedStage };
    }
    
    const stageIdToUpdate = parseInt(stageResult.stageId);
    
    // Validate stage ID before making the API call
    if (!stageIdToUpdate || stageIdToUpdate === 0 || isNaN(stageIdToUpdate)) {
      console.log(`ERROR: Invalid stage ID: ${stageResult.stageId} (parsed: ${stageIdToUpdate})`);
      return { success: false, reason: 'invalid_stage_id', stageId: stageResult.stageId };
    }
    
    // Check if deal is already at this stage
    if (deal.stageId === stageIdToUpdate) {
      console.log(`INFO: Deal ${deal.id} already at stage ID ${stageIdToUpdate}, no update needed`);
      return { success: true, dealId: deal.id, stageId: stageIdToUpdate, pipeline: pipelineName, skipped: true };
    }
    
    // Update the deal
    const updatePayload = { stageId: stageIdToUpdate };
    
    try {
      await fubAPI.put(`/deals/${deal.id}`, updatePayload);
      console.log(`SUCCESS: Updated existing deal ${deal.id} to stage '${formattedStage}' (ID: ${stageIdToUpdate})`);
      return { success: true, dealId: deal.id, stageId: stageIdToUpdate, pipeline: pipelineName };
    } catch (updateError) {
      // Handle API validation errors gracefully
      if (updateError.response?.status === 400 && updateError.response?.data?.errorMessage?.includes('No valid fields')) {
        console.log(`WARNING: API rejected update for deal ${deal.id} - likely already at target stage`);
        return { success: true, dealId: deal.id, stageId: stageIdToUpdate, pipeline: pipelineName, skipped: true };
      }
      throw updateError; // Re-throw other errors
    }
    
  } catch (error) {
    console.error(`FAILED: to update existing deal ${deal.id}:`, error.message);
    return { success: false, reason: 'update_failed', error: error.message };
  }
};

// Main webhook handler
app.post('/webhook/person-stage-updated', async (req, res) => {
  let person = null;
  let assignedUserId = null;
  
  try {
    console.log('=== WEBHOOK RECEIVED ===');
    console.log('Body:', JSON.stringify(req.body, null, 2));
    console.log('========================');
    
    const { event, resourceIds, data, uri, eventId } = req.body;
    
    // Deduplication check
    if (eventId && processedEvents.has(eventId)) {
      console.log(`DUPLICATE: event detected: ${eventId} - skipping`);
      return res.json({ success: true, message: 'Duplicate event ignored' });
    }
    
    if (event !== 'peopleStageUpdated' || !resourceIds || !data || !data.stage) {
      console.log('ERROR: Invalid webhook payload structure');
      return res.status(400).json({ error: 'Invalid webhook payload' });
    }
    
    // Mark event as processed
    if (eventId) {
      processedEvents.set(eventId, Date.now());
    }
    
    const personId = resourceIds[0];
    const stage = data.stage;
    
    console.log(`SUCCESS: Processing stage update for Person ID ${personId}: ${stage}`);
    
    // Get the full person data from FUB API
    console.log(`FETCHING: person data from FUB API for ID: ${personId}`);
    
    const personData = await fubAPI.get(`/people/${personId}`);
    
    if (!personData || !personData.id) {
      console.log('ERROR: No person data in FUB API response');
      await sendCriticalError(
        { name: 'Unknown', id: personId }, 
        stage, 
        'No person data in FUB API response', 
        null,
        []
      );
      return res.status(400).json({ error: 'No person data in response' });
    }
    
    // Person data is directly in the response
    person = personData;
    assignedUserId = person.assignedUserId;
    
    console.log(`SUCCESS: Retrieved person: ${person.name} (ID: ${person.id})`);
    console.log(`USER: Assigned User ID: ${assignedUserId}`);
    console.log(`TAGS: Person Tags: ${person.tags?.join(', ') || 'None'}`);
    console.log(`STAGE: New Stage: ${stage}`);
    
    // LOOP PREVENTION: Check for the TriggeredDealContactStageUpdates tag
    const hasLoopPreventionTag = await tagHelpers.hasLoopPreventionTag(person.tags);
    
    if (hasLoopPreventionTag) {
      console.log('LOOP_PREVENTION: Tag detected! This contact stage update was triggered by a deal stage change.');
      console.log('LOOP_PREVENTION: Removing tag and skipping deal updates to prevent infinite loop.');
      
      // Remove the tag
      await tagHelpers.removeLoopPreventionTag(personId);
      
      // Return success without updating any deals
      return res.json({ 
        success: true, 
        message: 'Loop prevention: Contact stage update originated from deal change, skipping deal update',
        loopPrevented: true
      });
    }
    
    console.log('LOOP_PREVENTION: No tag detected - proceeding with normal deal update logic');
    
    // Step 1: Get all existing deals for this person
    console.log(`FETCHING: all deals for person ${personId}...`);
    const allDeals = await fubAPI.get(`/deals?personId=${personId}`);
    console.log(`SUCCESS: Found ${allDeals.deals?.length || 0} existing deals`);
    
    // Step 2: Check if contact stage already matches ANY existing deal stage FIRST
    // This should check ALL deals regardless of pipeline to prevent duplicate creation
    if (allDeals.deals && allDeals.deals.length > 0) {
      for (const deal of allDeals.deals) {
        let dealStageName = normalize(deal.stage || '');
        let contactStageName = normalizeStageForComparison(stage);
        
        // Handle commercial stage formatting for comparison
        if (stage.toLowerCase().startsWith('commercial - ')) {
          contactStageName = normalizeStageForComparison(formatStageForCommercial(stage));
        }
        
        // If contact stage matches ANY existing deal stage (regardless of pipeline), do nothing
        if (dealStageName === contactStageName) {
          console.log(`INFO: Contact stage '${stage}' (normalized: '${contactStageName}') already matches existing deal ${deal.id} in ${deal.pipelineName || 'Unknown'} pipeline with stage '${deal.stage}' - no action required`);
          return res.json({ 
            success: true, 
            message: 'Contact stage matches existing deal stage across pipelines, no action required',
            matchedDealId: deal.id,
            matchedPipeline: deal.pipelineName,
            originalContactStage: stage,
            normalizedContactStage: contactStageName,
            matchedDealStage: deal.stage
          });
        }
      }
      console.log(`INFO: Contact stage '${stage}' (normalized: '${normalizeStageForComparison(stage)}') does not match any existing deal stages - proceeding with pipeline logic`);
    }

    // Step 3: Extract pipeline information from tags OR detect Commercial from stage
    let pipelineTags = [];
    let isCommercialStage = false;
    
    // Check if this is a commercial stage (starts with 'COMMERCIAL - ')
    if (stage.toLowerCase().startsWith('commercial - ')) {
      console.log(`COMMERCIAL: stage detected: ${stage}`);
      pipelineTags = ['Commercial'];
      isCommercialStage = true;
    } else {
      // Regular tag-based pipeline detection (excludes Commercial)
      pipelineTags = extractPipelineFromTags(person.tags);
      console.log(`TAGS: Extracted pipeline tags from [${person.tags?.join(', ') || 'None'}]: [${pipelineTags.join(', ')}]`);
    }

    // Step 4: Enhanced pipeline logic based on stage matching
    if (pipelineTags.length === 0) {
      // Check if there's exactly one existing deal - if so, update it instead of sending notification
      if (allDeals.deals && allDeals.deals.length === 1) {
        console.log('TARGET: No pipeline tags detected but exactly one deal exists - attempting to update it');
        const existingDeal = allDeals.deals[0];
        
        const updateResult = await updateExistingDealWithoutPipelineTags(existingDeal, stage);
        
        if (updateResult.success) {
          return res.json({
            success: true,
            message: 'Updated existing deal without pipeline tags',
            dealId: updateResult.dealId,
            stageId: updateResult.stageId,
            pipeline: updateResult.pipeline
          });
        } else {
          // If update failed because stage doesn't exist, that's expected for non-deal stages
          if (updateResult.reason === 'stage_not_found') {
            console.log(`INFO: Stage '${stage}' is not a deal stage - no action required`);
            return res.json({ success: true, message: 'Non-deal stage, no action required' });
          } else {
            // Only send error notification for actual errors
            await sendCriticalError(
              person, 
              stage, 
              `Failed to update existing deal ${existingDeal.id}: ${updateResult.reason}`, 
              null, 
              pipelineTags
            );
            return res.json({ success: true, message: 'Failed to update existing deal, error notification sent' });
          }
        }
      }
      // No existing deals and no pipeline tags - check if this is actually a deal stage
      else if (!allDeals.deals || allDeals.deals.length === 0) {
        // First check if this stage exists in any pipeline (i.e., is a valid deal stage)
        const isValidStage = await isValidDealStage(stage);
        
        if (!isValidStage) {
          console.log(`INFO: Stage '${stage}' is not a valid deal stage in any pipeline - no action required`);
          return res.json({ success: true, message: 'Non-deal stage, no action required' });
        }
        
        // Only send notification if it's a valid deal stage but no pipeline tags detected
        console.log('ERROR: Valid deal stage detected but no pipeline tags - sending notification');
        await sendPipelineDetectionFailure(person, stage, assignedUserId, pipelineTags);
        return res.json({ success: true, message: 'Valid deal stage but no pipeline tags detected, notification sent' });
      } else {
        console.log('ERROR: No pipeline tags detected but multiple existing deals found - proceeding with deletion logic');
        // Continue to deletion logic below
      }
    } else {
      // If we have pipeline tags, check stage matching
      const matchingPipelines = [];
      
      for (const pipelineTag of pipelineTags) {
        let testPipelineId;
        let formattedStage = stage;
        
        // Get pipeline ID and format stage
        if (pipelineTag === 'Commercial') {
          try {
            const allPipelines = await fubAPI.get('/pipelines');
            const commercialPipeline = allPipelines.pipelines?.find(p => 
              p.name && p.name.toLowerCase().includes('commercial')
            );
            if (commercialPipeline) {
              testPipelineId = commercialPipeline.id;
              formattedStage = formatStageForCommercial(stage);
            }
          } catch (error) {
            console.error('FAILED: to fetch Commercial pipeline:', error.message);
            continue;
          }
        } else {
          testPipelineId = PIPELINE_MAPPING[pipelineTag];
          
          // Check for pipeline-specific stage mappings first
          const pipelineSpecificStage = getPipelineSpecificStage(stage, pipelineTag);
          if (pipelineSpecificStage) {
            formattedStage = pipelineSpecificStage;
            console.log(`PIPELINE_SPECIFIC: ${stage} in ${pipelineTag} pipeline → ${pipelineSpecificStage}`);
          } else {
            formattedStage = formatStageForBuyer(pipelineTag, stage);
          }
        }
        
        if (!testPipelineId) continue;
        
        // Get stages for this pipeline and check if contact stage matches
        try {
          const pipelineStages = await fubAPI.get(`/pipelines/${testPipelineId}`);
          const stageNames = pipelineStages.stages?.map(s => normalize(s.name)) || [];
          
          // Check both the original formatted stage AND the normalized version
          const formattedStageNormalized = normalize(formattedStage);
          const mappedStage = normalizeStageForComparison(formattedStage);
          
          if (stageNames.includes(formattedStageNormalized) || stageNames.includes(mappedStage)) {
            matchingPipelines.push({
              tag: pipelineTag,
              id: testPipelineId,
              formattedStage: formattedStage
            });
            console.log(`SUCCESS: Stage '${formattedStage}' (or mapped equivalent) found in ${pipelineTag} pipeline`);
          } else {
            console.log(`ERROR: Stage '${formattedStage}' (normalized: '${formattedStageNormalized}', mapped: '${mappedStage}') not found in ${pipelineTag} pipeline stages: [${stageNames.join(', ')}]`);
          }
        } catch (error) {
          console.error(`FAILED: to check ${pipelineTag} pipeline:`, error.message);
        }
      }

      // Decision logic based on matching pipelines
      if (matchingPipelines.length === 0) {
        console.log('ERROR: Contact stage matches no pipeline stages - proceed with deletion logic');
        // Continue to deletion logic below
      } else if (matchingPipelines.length > 1) {
        console.log('ERROR: Contact stage matches multiple pipeline stages');
        
        // Only send notification if there are NO existing deals
        if (!allDeals.deals || allDeals.deals.length === 0) {
          console.log('INFO: No existing deals found - sending pipeline detection notification');
          await sendPipelineDetectionFailure(person, stage, assignedUserId, pipelineTags);
          return res.json({ success: true, message: 'Stage matches multiple pipelines, notification sent' });
        } else {
          console.log('INFO: Multiple deals exist - skipping notification to avoid duplicates');
          return res.json({ success: true, message: 'Stage matches multiple pipelines but deals exist, no notification sent' });
        }
      } else {
        // Single matching pipeline - skip deletion and go straight to deal management
        const selectedPipeline = matchingPipelines[0];
        const pipelineTag = selectedPipeline.tag;
        const pipelineId = selectedPipeline.id;
        const formattedStage = selectedPipeline.formattedStage;
        
        console.log(`TARGET: Using pipeline: ${pipelineTag} (ID: ${pipelineId}) for stage '${formattedStage}'`);
        
        // Skip deletion logic and jump to deal management
        const pipelineStages = await fubAPI.get(`/pipelines/${pipelineId}`);
        const existingDeals = await fubAPI.get(`/deals?pipelineId=${pipelineId}&personId=${personId}`);
        
        // Check for duplicate active deals in this pipeline
        if (existingDeals.deals && existingDeals.deals.length > 0) {
          const activeDeals = existingDeals.deals.filter(isDealActive);
          if (activeDeals.length > 1) {
            await createDuplicateDealsTask(person, stage, pipelineTag, activeDeals);
          }
        }
        
        // Find the stage ID and handle deal creation/update
        const stageResult = findStageId({
          stageName: formattedStage,
          stageNames: pipelineStages.stages?.map(s => s.name).join(',') || '',
          stageIds: pipelineStages.stages?.map(s => s.id).join(',') || '',
          dealID: existingDeals.deals?.map(d => d.id).join(',') || ''
        });
        
        if (stageResult.stageId === '0') {
          await sendCriticalError(person, stage, `Stage '${formattedStage}' not found in pipeline ${pipelineTag}`, null, pipelineTags);
          return res.json({ success: true, message: 'Stage not found in pipeline' });
        }

        // Handle deal creation/update
        if (stageResult.shouldCreateDeal === 'yes') {
          try {
            const createPayload = {
              name: person.name || 'Untitled Deal',
              stageId: parseInt(stageResult.stageId),
              peopleIds: [parseInt(personId)],
              userIds: [parseInt(assignedUserId)]
            };
            const newDeal = await fubAPI.post('/deals', createPayload);
            return res.json({ 
              success: true, 
              message: 'Deal created', 
              dealId: newDeal.id,
              pipelineId: parseInt(pipelineId),
              stageId: parseInt(stageResult.stageId)
            });
          } catch (error) {
            await sendCriticalError(person, stage, `Failed to create deal: ${error.response?.data ? JSON.stringify(error.response.data) : error.message}`, error, pipelineTags);
            return res.status(500).json({ error: 'Failed to create deal' });
          }
        }      
        
        // Handle deal update
        if (stageResult.shouldUpdateDeal === 'yes') {
          try {
            console.log(`INFO: existingDeals.deals array:`, existingDeals.deals);
            console.log(`INFO: existingDeals.deals length:`, existingDeals.deals?.length);
            
            if (!existingDeals.deals || existingDeals.deals.length === 0) {
              console.log(`ERROR: No deals found in pipeline ${pipelineId} for person ${personId}`);
              return res.json({ success: true, message: 'No deals found in specific pipeline' });
            }
            
            const dealId = existingDeals.deals[0].id;
            const stageIdToUpdate = parseInt(stageResult.stageId);
            
            console.log(`TARGET: Deal ID to update: ${dealId}`);
            console.log(`TARGET: Stage ID to update to: ${stageIdToUpdate}`);
            
            // Validate stage ID before making the API call
            if (!stageIdToUpdate || stageIdToUpdate === 0 || isNaN(stageIdToUpdate)) {
              console.log(`ERROR: Invalid stage ID: ${stageResult.stageId} (parsed: ${stageIdToUpdate})`);
              return res.json({ success: true, message: 'Invalid stage ID, skipping update' });
            }
            
            // Check if deal is already at this stage
            const currentDeal = existingDeals.deals[0];
            if (currentDeal.stageId === stageIdToUpdate) {
              console.log(`INFO: Deal ${dealId} already at stage ID ${stageIdToUpdate}, no update needed`);
              return res.json({ 
                success: true, 
                message: 'Deal already at target stage', 
                dealId: dealId,
                currentStageId: stageIdToUpdate
              });
            }
            
            await fubAPI.put(`/deals/${dealId}`, { stageId: stageIdToUpdate });
            return res.json({ 
              success: true, 
              message: 'Deal updated', 
              dealId: dealId,
              newStageId: stageIdToUpdate
            });
          } catch (error) {
            // Only send error notification for real errors, not API validation errors
            if (error.response?.status === 400 && error.response?.data?.errorMessage?.includes('No valid fields')) {
              console.log(`WARNING: API rejected update - likely already at target stage or invalid data`);
              return res.json({ success: true, message: 'Update skipped - API validation failed' });
            }
            
            await sendCriticalError(person, stage, `Failed to update deal: ${error.response?.data ? JSON.stringify(error.response.data) : error.message}`, error, pipelineTags);
            return res.status(500).json({ error: 'Failed to update deal' });
          }
        }
        
        return res.json({ success: true, message: 'Deal processing complete' });
      }
    }

    // Step 5: Enhanced deal deletion logic (only runs if no stage matches found)
    if (allDeals.deals && allDeals.deals.length > 0) {
      const dealsToDelete = [];
      
      for (const deal of allDeals.deals) {
        // Get available stages for this deal's pipeline to check if contact stage matches
        let availableStageNames = [];
        try {
          const pipelineStages = await fubAPI.get(`/pipelines/${deal.pipelineId}`);
          availableStageNames = pipelineStages.stages?.map(s => s.name) || [];
        } catch (error) {
          console.error(`FAILED: to get stages for pipeline ${deal.pipelineId}:`, error.message);
        }
        
        if (shouldDeleteDeal(deal, stage, availableStageNames)) {
          dealsToDelete.push(deal);
        }
      }
      
      // Delete the marked deals
      for (const deal of dealsToDelete) {
        try {
          console.log(`DELETE: Deleting deal ${deal.id} (${deal.stage} in ${deal.pipelineName})`);
          await fubAPI.delete(`/deals/${deal.id}`);
          console.log(`SUCCESS: Successfully deleted deal ${deal.id}`);
        } catch (error) {
          console.error(`FAILED: to delete deal ${deal.id}:`, error.message);
          await sendCriticalError(person, stage, `Failed to delete deal ${deal.id}`, error, pipelineTags);
        }
      }
      
      if (dealsToDelete.length > 0) {
        console.log(`SUCCESS: Deletion complete. Deleted ${dealsToDelete.length} deals`);
        return res.json({ 
          success: true, 
          message: `Deleted ${dealsToDelete.length} deals`,
          deletedDeals: dealsToDelete.map(d => d.id)
        });
      }
    }
    
    // If we reach here, no action was taken
    console.log(`INFO: No action required for ${person.name} - stage '${stage}'`);
    return res.json({ success: true, message: 'No action required' });
    
  } catch (error) {
    console.error('CRITICAL: webhook error:', error);
    console.error('Error stack:', error.stack);
    
    // Send critical error notification
    await sendCriticalError(
      person || { name: 'Unknown', id: 'Unknown' }, 
      req.body.data?.stage || 'Unknown', 
      'Critical webhook processing error', 
      error,
      []
    );
    
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Updated critical error notification function
async function sendCriticalError(person, stage, errorMessage, error, pipelineTags = []) {
  try {
    const errorStack = error?.stack ? error.stack.substring(0, 500) : 'No stack trace available';
    const errorDetails = error ? `\nError: ${error.message}\nStack: ${errorStack}` : '';
    const pipelineInfo = pipelineTags.length > 0 ? `\n*Detected Pipeline Tags:* ${pipelineTags.join(', ')}` : '\n*Detected Pipeline Tags:* None';
    
    const message = `ALERT: *CRITICAL ERROR - FUB Contact-Deal Sync*
    
*Contact:* ${person.name || 'Unknown'}
*Contact ID:* ${person.id || 'Unknown'}
*Stage:* ${stage}${pipelineInfo}
*Error:* ${errorMessage}
${errorDetails}

*Contact Link:* https://align.followupboss.com/2/people/view/${person.id}

This requires immediate attention. The automation failed to process this contact properly.`;

    // Send to notifications channel
    if (CONFIG.SLACK_NOTIFICATIONS_CHANNEL_ID) {
      await slackAPI.sendChannelMessage(CONFIG.SLACK_NOTIFICATIONS_CHANNEL_ID, message);
      console.log(`SUCCESS: Critical error notification sent to channel ${CONFIG.SLACK_NOTIFICATIONS_CHANNEL_ID}`);
    } else {
      console.error('ERROR: Cannot send critical error notification - SLACK_NOTIFICATIONS_CHANNEL_ID not configured');
    }
    
  } catch (notificationError) {
    console.error('FAILED: to send critical error notification:', {
      message: notificationError.message,
      originalError: errorMessage
    });
  }
}

// Updated notification functions
async function sendPipelineDetectionFailure(person, stage, assignedUserId, pipelineTags = []) {
  try {
    const message = `Hi! We tried to update the contact for ${person.name} for you when you updated the contact stage to ${stage} but we couldn't figure out which pipeline it's in. Please take a moment to <https://form.jotform.com/241376746869171?fubLead=${person.id}&leadName=${encodeURIComponent(person.name)}&updatedLead=${encodeURIComponent(stage)}&agentId=${assignedUserId}|click here and let us know> which pipeline the client is in and we'll generate the deal card for you. Let us know if you have any questions!

-AIDA`;

    // Try to get assigned user info and find their Slack ID
    try {
      const assignedUser = await fubAPI.get(`/users/${assignedUserId}`);
      if (assignedUser?.email) {
        const slackUser = await findSlackUserByEmail(assignedUser.email);
        if (slackUser && slackUser.id) {
          await slackAPI.sendDM(slackUser.id, message);
          console.log(`SUCCESS: Pipeline detection failure notification sent to assigned user via Slack`);
          return; // Successfully sent to agent, no need for channel notification
        }
      }
    } catch (error) {
      console.log(`WARNING: Could not notify assigned user ${assignedUserId} directly`);
    }
    
    // Fallback: Send to notifications channel
    if (CONFIG.SLACK_NOTIFICATIONS_CHANNEL_ID) {
      const channelMessage = `TASK: *Pipeline Detection Needed*

*Contact:* ${person.name} (ID: ${person.id})
*Stage:* ${stage}
*Assigned User:* ${assignedUserId}

${message}`;
      
      await slackAPI.sendChannelMessage(CONFIG.SLACK_NOTIFICATIONS_CHANNEL_ID, channelMessage);
      console.log(`SUCCESS: Pipeline detection failure notification sent to channel`);
    }
    
  } catch (error) {
    console.error('FAILED: to send pipeline detection failure notification:', error);
  }
}

// Helper function to find Slack user by email
async function findSlackUserByEmail(email) {
  try {
    const response = await axios.get('https://slack.com/api/users.lookupByEmail', {
      headers: {
        'Authorization': `Bearer ${CONFIG.SLACK_BOT_TOKEN}`
      },
      params: { email: email },
      timeout: 10000
    });
    
    if (response.data.ok) {
      return response.data.user;
    }
  } catch (error) {
    console.log('Slack lookup failed:', error.message);
  }
  
  return null;
}

async function createDuplicateDealsTask(person, contactStage, pipelineName, activeDeals) {
  try {
    const title = `Duplicate Deals Detected - ${person.name} (ID: ${person.id})`;
    const description = `FUB Client: https://align.followupboss.com/2/people/view/${person.id}

The agent just submitted a contact stage update to: ${contactStage} with a pipeline tag: ${pipelineName}.

AIDA detected multiple active deals in the same pipeline. Please review and delete the duplicate if needed. Make sure the remaining deal gets updated to the stage above.

Next Steps:
1. Review the deals in FUB
2. Delete any duplicates
3. Update the remaining deal to the correct stage: ${contactStage}`;

    const task = await asanaAPI.createTask(title, description, CONFIG.ASANA_ASSIGNEE_GID);
    console.log(`SUCCESS: Created Asana task ${task.data.gid} for duplicate deals`);
    
  } catch (error) {
    console.error('FAILED: to create Asana task for duplicate deals:', error);
    
    // Send Slack notification as fallback
    try {
      const fallbackMessage = `WARNING: *Asana Task Creation Failed*
      
Failed to create Asana task for duplicate deals detection.

*Contact:* ${person.name} (ID: ${person.id})
*Stage:* ${contactStage}
*Pipeline:* ${pipelineName}

Please manually review this contact for duplicate deals.

*Error:* ${error.message}`;

      if (CONFIG.SLACK_NOTIFICATIONS_CHANNEL_ID) {
        await slackAPI.sendChannelMessage(CONFIG.SLACK_NOTIFICATIONS_CHANNEL_ID, fallbackMessage);
      }
    } catch (slackError) {
      console.error('FAILED: to send fallback Slack notification:', slackError);
    }
  }
}

async function sendDuplicateDealsWarning(person, pipelineTag, deals) {
  try {
    const message = `WARNING: *Duplicate Deals Warning*
    
*Contact:* ${person.name}
*Contact ID:* ${person.id}
*Pipeline:* ${pipelineTag}

AIDA found multiple deals on that pipeline. Please review the deals on that contact. If one is stage 'Closed' and the other is in an active stage, please update the active deal stage. If there are duplicates, please condense and ensure the remaining deal gets updated to the correct stage.

*Contact Link:* https://align.followupboss.com/2/people/view/${person.id}

*Deals Found:*
${deals.map(deal => `• Deal ID: ${deal.id} - Stage: ${deal.stage}`).join('\n')}

Thanks!`;

    if (CONFIG.SLACK_NOTIFICATIONS_CHANNEL_ID) {
      await slackAPI.sendChannelMessage(CONFIG.SLACK_NOTIFICATIONS_CHANNEL_ID, message);
      console.log(`SUCCESS: Duplicate deals warning sent for ${person.name}`);
    }
    
  } catch (error) {
    console.error('FAILED: to send duplicate deals warning:', error);
  }
}

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// Test endpoint for checking configuration
app.get('/test-config', async (req, res) => {
  try {
    const configStatus = {
      fub: !!CONFIG.FUB_API_KEY,
      slack: !!CONFIG.SLACK_BOT_TOKEN,
      asana: !!CONFIG.ASANA_ACCESS_TOKEN,
      environment_variables: {
        FUB_API_KEY: !!CONFIG.FUB_API_KEY,
        SLACK_BOT_TOKEN: !!CONFIG.SLACK_BOT_TOKEN,
        SLACK_OPERATIONS_USER_ID: !!CONFIG.SLACK_OPERATIONS_USER_ID,
        SLACK_OWNER_USER_ID: !!CONFIG.SLACK_OWNER_USER_ID,
        SLACK_NOTIFICATIONS_CHANNEL_ID: !!CONFIG.SLACK_NOTIFICATIONS_CHANNEL_ID,
        ASANA_ACCESS_TOKEN: !!CONFIG.ASANA_ACCESS_TOKEN,
        ASANA_PROJECT_ID: !!CONFIG.ASANA_PROJECT_ID,
        ASANA_ASSIGNEE_GID: !!CONFIG.ASANA_ASSIGNEE_GID
      }
    };

    // Test Asana connection if token is available
    if (CONFIG.ASANA_ACCESS_TOKEN) {
      configStatus.asana_connection = await asanaAPI.testConnection();
    }

    res.json({
      status: 'Configuration check complete',
      timestamp: new Date().toISOString(),
      config: configStatus
    });

  } catch (error) {
    res.status(500).json({
      error: 'Configuration test failed',
      details: error.message
    });
  }
});

// Start server
app.listen(CONFIG.PORT, () => {
  console.log(`FUB Contact-to-Deal Sync server running on port ${CONFIG.PORT}`);
  console.log('Configuration status:');
  console.log(`- FUB API Key: ${CONFIG.FUB_API_KEY ? 'SUCCESS: Set' : 'ERROR: Missing'}`);
  console.log(`- Slack Bot Token: ${CONFIG.SLACK_BOT_TOKEN ? 'SUCCESS: Set' : 'ERROR: Missing'}`);
  console.log(`- Asana Access Token: ${CONFIG.ASANA_ACCESS_TOKEN ? 'SUCCESS: Set' : 'ERROR: Missing'}`);
  console.log(`- Operations User ID: ${CONFIG.SLACK_OPERATIONS_USER_ID ? 'SUCCESS: Set' : 'ERROR: Missing'}`);
  console.log(`- Owner User ID: ${CONFIG.SLACK_OWNER_USER_ID ? 'SUCCESS: Set' : 'ERROR: Missing'}`);
  console.log(`- Asana Project ID: ${CONFIG.ASANA_PROJECT_ID ? 'SUCCESS: Set' : 'ERROR: Missing'}`);
  console.log(`- Asana Assignee GID: ${CONFIG.ASANA_ASSIGNEE_GID ? 'SUCCESS: Set' : 'ERROR: Missing'}`);
});

module.exports = app;

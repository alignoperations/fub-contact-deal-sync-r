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
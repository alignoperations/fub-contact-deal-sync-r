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
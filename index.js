// FUB Contact-to-Deal Sync Automation
// Handles creating, updating, and deleting deals based on contact stage changes
// Converts email notifications to Slack DMs

const axios = require('axios');
const express = require('express');
const app = express();

// Configuration
const CONFIG = {
  FUB_API_KEY: process.env.FUB_API_KEY,
  SLACK_BOT_TOKEN: process.env.SLACK_BOT_TOKEN,
  SLACK_OPERATIONS_USER_ID: process.env.SLACK_OPERATIONS_USER_ID, // operations@alignteam.com
  SLACK_OWNER_USER_ID: process.env.SLACK_OWNER_USER_ID, // Your user ID for critical errors
  FUB_BASE_URL: 'https://api.followupboss.com/v1',
  PORT: process.env.PORT || 3000
};

// Middleware
app.use(express.json());

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

// Slack API Helper
const slackAPI = {
  async sendDM(userId, message) {
    try {
      const response = await axios.post('https://slack.com/api/chat.postMessage', {
        channel: userId,
        text: message,
        mrkdwn: true
      }, {
        headers: {
          'Authorization': `Bearer ${CONFIG.SLACK_BOT_TOKEN}`,
          'Content-Type': 'application/json'
        }
      });
      return response.data;
    } catch (error) {
      console.error('Slack API error:', error.response?.data || error.message);
      throw error;
    }
  }
};

// Stage mapping configuration
const STAGE_MAPPING = {
  stagesToKeepByPipeline: {
    buyer: [
      "attorney review", "under contract", "closed",
      "offer rejected", "fell through"
    ],
    listing: [
      "listing agreement", "pre-listing", "active off-market", 
      "active listing", "attorney review", "under contract", 
      "closed", "temporarily off market", "expired", "cancelled",
      "fell through"
    ],
    landlord: [
      "listing agreement", "pre-listing", "active off-market",
      "active listing", "application accepted", "closed", 
      "expired", "cancelled", "fell through"
    ],
    tenant: [
      "application accepted", "closed", "application rejected", 
      "fell through"
    ]
  },
  
  alwaysKeepStages: [
    "closed", "2023 closed", "2022 closed", "2021 closed"
  ],
  
  pipelinesToIgnore: [
    "agent recruiting", "outgoing referral", "investments acquisition", 
    "commercial"
  ]
};

// Pipeline tag mapping
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
  
  // Check for each pipeline type
  Object.keys(PIPELINE_MAPPING).forEach(pipeline => {
    if (tagStr.includes(pipeline.toLowerCase())) {
      pipelineTags.push(pipeline);
    }
  });
  
  return [...new Set(pipelineTags)]; // Remove duplicates
};

const shouldDeleteDeal = (inputData) => {
  const { stageIds, stageNames, pipelineNames, updatedStage, dealIds } = inputData;
  const dealIdsToDelete = [];
  
  // Check if we should delete deals based on stage change
  if (["lead", "attempted contact", "spoke with customer", "unresponsive", "nurture"].includes(updatedStage)) {
    for (let i = 0; i < dealIds.length; i++) {
      const dealId = dealIds[i]?.trim();
      const stage = normalize(stageNames[i]);
      const pipeline = normalize(pipelineNames[i]);
      
      if (!dealId || STAGE_MAPPING.pipelinesToIgnore.includes(pipeline)) {
        continue;
      }
      
      const allowedStages = STAGE_MAPPING.stagesToKeepByPipeline[pipeline] || [];
      const normalizedAllowedStages = allowedStages.map(normalize);
      
      if (!normalizedAllowedStages.includes(stage) && 
          !STAGE_MAPPING.alwaysKeepStages.includes(stage)) {
        dealIdsToDelete.push(dealId);
      }
    }
  }
  
  return dealIdsToDelete;
};

const findStageId = (inputData) => {
  const { stageName, stageNames, stageIds, dealID } = inputData;
  
  const inputName = normalize(stageName);
  const namesArray = (stageNames || "").split(',').map(name => name.trim().toLowerCase());
  const idsArray = (stageIds || "").split(',').map(id => id.trim());
  const dealIdsArray = (dealID || "").split(',').map(id => id.trim()).filter(Boolean);
  
  // Find the stage ID by matching stage name
  const index = namesArray.indexOf(inputName);
  const matchedId = index !== -1 ? idsArray[index] : "0";
  
  console.log(`Stage mapping: "${inputName}" → Stage ID: ${matchedId}`);
  console.log(`Available stages: ${namesArray.join(', ')}`);
  console.log(`Available stage IDs: ${idsArray.join(', ')}`);
  
  let shouldCreateDeal = "no";
  let shouldUpdateDeal = "no";
  let skipUpdate = "no";
  
  // Decision logic
  if (dealIdsArray.length === 0) {
    // No deals at all → Create
    shouldCreateDeal = "yes";
    console.log(`Decision: CREATE (no existing deals)`);
  } else if (dealIdsArray.length > 1) {
    // Multiple deals → Skip
    skipUpdate = "yes";
    console.log(`Decision: SKIP (multiple deals: ${dealIdsArray.length})`);
  } else {
    // One deal → check if it matches or update
    if (matchedId === "0" && STAGE_MAPPING.alwaysKeepStages.includes(inputName)) {
      skipUpdate = "yes";
      console.log(`Decision: SKIP (stage not found but in always keep list)`);
    } else if (matchedId === "0") {
      console.log(`Decision: ERROR (stage not found and not in always keep list)`);
    } else {
      shouldUpdateDeal = "yes";
      console.log(`Decision: UPDATE (one deal exists, stage found)`);
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
  // When contact stage is "A (<30)", the deal stage should be "A (<30) + Agency"
  if (pipelineName === "Buyer" && stageName === "A (<30)") {
    return "A (<30) + Agency";
  }
  return stageName; // Return original stage name for all other cases
};

// Main webhook handler
app.post('/webhook/person-stage-updated', async (req, res) => {
  try {
    // Log the entire webhook payload for debugging
    console.log('=== WEBHOOK RECEIVED ===');
    console.log('Headers:', JSON.stringify(req.headers, null, 2));
    console.log('Body:', JSON.stringify(req.body, null, 2));
    console.log('========================');
    
    const { person, stage, assignedUserId } = req.body;
    
    if (!person || !stage) {
      console.log('❌ Missing required fields in webhook payload');
      console.log('Available fields:', Object.keys(req.body));
      return res.status(400).json({ error: 'Missing required fields' });
    }
    
    console.log(`Processing stage update for ${person.name}: ${stage}`);
    
    // Step 1: Check if this is a stage change that triggers deletion
    const isDeletionStage = ["lead", "attempted contact", "spoke with customer", "unresponsive", "nurture"].includes(normalize(stage));
    console.log(`Stage "${stage}" is deletion stage: ${isDeletionStage}`);
    
    if (isDeletionStage) {
      // Get existing deals for this person
      const deals = await fubAPI.get(`/deals?personId=${person.id}`);
      console.log(`Found ${deals.deals?.length || 0} existing deals for person ${person.id}`);
      
      // Check if we should delete any deals
      const dealIdsToDelete = shouldDeleteDeal({
        stageIds: deals.deals?.map(d => d.id.toString()) || [],
        stageNames: deals.deals?.map(d => d.stage) || [],
        pipelineNames: deals.deals?.map(d => d.pipelineName) || [],
        updatedStage: normalize(stage),
        dealIds: deals.deals?.map(d => d.id.toString()) || []
      });
      
      console.log(`Deals to delete: ${dealIdsToDelete.length}`, dealIdsToDelete);
      
      // Delete deals if needed
      for (const dealId of dealIdsToDelete) {
        try {
          await fubAPI.delete(`/deals/${dealId}`);
          console.log(`✅ Successfully deleted deal ${dealId}`);
        } catch (error) {
          console.error(`❌ Failed to delete deal ${dealId}:`, error.message);
          await sendCriticalError(person, stage, `Failed to delete deal ${dealId}`, error);
        }
      }
      
      if (dealIdsToDelete.length > 0) {
        return res.json({ 
          success: true, 
          message: `Deleted ${dealIdsToDelete.length} deals`,
          deletedDeals: dealIdsToDelete 
        });
      }
    }
    
    // Step 2: Extract pipeline information from tags
    const pipelineTags = extractPipelineFromTags(person.tags);
    console.log(`Extracted pipeline tags: ${pipelineTags.join(', ')}`);
    
    // Step 3: Handle different pipeline scenarios
    if (pipelineTags.length === 0) {
      console.log('❌ No pipeline tags detected');
      // No pipeline tags - send notification
      await sendPipelineDetectionFailure(person, stage, assignedUserId);
      return res.json({ success: true, message: 'No pipeline tags detected, notification sent' });
    }
    
    if (pipelineTags.length > 1) {
      console.log('❌ Multiple pipeline tags detected:', pipelineTags);
      // Multiple pipeline tags - send notification  
      await sendPipelineDetectionFailure(person, stage, assignedUserId);
      return res.json({ success: true, message: 'Multiple pipeline tags detected, notification sent' });
    }
    
    // Step 4: Single pipeline tag - proceed with deal management
    const pipelineTag = pipelineTags[0];
    const pipelineId = PIPELINE_MAPPING[pipelineTag];
    console.log(`Using pipeline: ${pipelineTag} (ID: ${pipelineId})`);
    
    if (!pipelineId) {
      console.log('❌ Unknown pipeline tag:', pipelineTag);
      await sendPipelineDetectionFailure(person, stage, assignedUserId);
      return res.json({ success: true, message: 'Unknown pipeline tag, notification sent' });
    }
    
    // Get pipeline stages
    const pipelineStages = await fubAPI.get(`/pipelines/${pipelineId}`);
    console.log(`Pipeline ${pipelineId} has ${pipelineStages.stages?.length || 0} stages`);
    
    // Format stage name if needed (handle special buyer mapping)
    let formattedStage = stage;
    if (pipelineTag === "Buyer") {
      formattedStage = formatStageForBuyer("Buyer", stage);
      console.log(`Formatted buyer stage: "${stage}" → "${formattedStage}"`);
    }
    
    // Get existing deals for this person and pipeline
    const existingDeals = await fubAPI.get(`/deals?pipelineId=${pipelineId}&personId=${person.id}`);
    console.log(`Found ${existingDeals.deals?.length || 0} existing deals for pipeline ${pipelineId}`);
    
    // Find the stage ID
    const stageResult = findStageId({
      stageName: formattedStage,
      stageNames: pipelineStages.stages?.map(s => s.name).join(',') || '',
      stageIds: pipelineStages.stages?.map(s => s.id).join(',') || '',
      dealID: existingDeals.deals?.map(d => d.id).join(',') || ''
    });
    
    console.log(`Stage mapping result:`, stageResult);
    
    if (stageResult.stageId === "0") {
      console.log(`❌ Stage "${formattedStage}" not found in pipeline ${pipelineTag}`);
      await sendCriticalError(person, stage, `Stage "${formattedStage}" not found in pipeline ${pipelineTag}`, null);
      return res.json({ success: true, message: 'Stage not found in pipeline' });
    }
    
    // Step 5: Handle deal creation/update based on logic
    if (stageResult.shouldCreateDeal === "yes") {
      try {
        const newDeal = await fubAPI.post('/deals', {
          personId: parseInt(person.id),
          pipelineId: parseInt(pipelineId),
          stageId: parseInt(stageResult.stageId),
          assignedUserId: parseInt(assignedUserId)
        });
        
        console.log(`✅ Created new deal ${newDeal.id} for ${person.name} - Pipeline: ${pipelineId}, Stage: ${stageResult.stageId}`);
        return res.json({ 
          success: true, 
          message: 'Deal created', 
          dealId: newDeal.id,
          pipelineId: parseInt(pipelineId),
          stageId: parseInt(stageResult.stageId)
        });
      } catch (error) {
        console.error(`❌ Failed to create deal for ${person.name}:`, error.message);
        console.error(`Create deal payload:`, {
          personId: parseInt(person.id),
          pipelineId: parseInt(pipelineId),
          stageId: parseInt(stageResult.stageId),
          assignedUserId: parseInt(assignedUserId)
        });
        await sendCriticalError(person, stage, `Failed to create deal`, error);
        return res.status(500).json({ error: 'Failed to create deal' });
      }
    }
    
    if (stageResult.shouldUpdateDeal === "yes") {
      try {
        const dealId = existingDeals.deals[0].id;
        const updatePayload = {
          stageId: parseInt(stageResult.stageId)
        };
        
        await fubAPI.put(`/deals/${dealId}`, updatePayload);
        
        console.log(`✅ Updated deal ${dealId} for ${person.name} - New Stage ID: ${stageResult.stageId}`);
        return res.json({ 
          success: true, 
          message: 'Deal updated', 
          dealId: dealId,
          newStageId: parseInt(stageResult.stageId)
        });
      } catch (error) {
        console.error(`❌ Failed to update deal for ${person.name}:`, error.message);
        console.error(`Update deal payload:`, {
          dealId: existingDeals.deals[0].id,
          stageId: parseInt(stageResult.stageId)
        });
        await sendCriticalError(person, stage, `Failed to update deal`, error);
        return res.status(500).json({ error: 'Failed to update deal' });
      }
    }
    
    if (stageResult.skipUpdate === "yes") {
      console.log(`⚠️ Multiple deals detected for ${person.name}, sending notification`);
      // Multiple deals - send duplicate warning
      await sendDuplicateDealsWarning(person, pipelineTag, existingDeals.deals);
      return res.json({ success: true, message: 'Multiple deals detected, notification sent' });
    }
    
    console.log(`ℹ️ No action required for ${person.name}`);
    return res.json({ success: true, message: 'No action required' });
    
  } catch (error) {
    console.error('❌ Critical webhook error:', error);
    console.error('Error stack:', error.stack);
    console.error('Request body:', JSON.stringify(req.body, null, 2));
    
    // Send critical error notification
    await sendCriticalError(
      req.body.person || { name: 'Unknown', id: 'Unknown' }, 
      req.body.stage || 'Unknown', 
      'Critical webhook processing error', 
      error
    );
    
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Critical error notification function
async function sendCriticalError(person, stage, errorMessage, error) {
  try {
    const errorDetails = error ? `\nError: ${error.message}\nStack: ${error.stack?.substring(0, 500)}` : '';
    
    const message = `🚨 *CRITICAL ERROR - FUB Contact-Deal Sync*
    
*Contact:* ${person.name}
*Contact ID:* ${person.id}
*Stage:* ${stage}
*Error:* ${errorMessage}
${errorDetails}

*Contact Link:* https://align.followupboss.com/2/people/view/${person.id}

This requires immediate attention. The automation failed to process this contact properly.`;

    // Send to owner for critical errors
    if (CONFIG.SLACK_OWNER_USER_ID) {
      await slackAPI.sendDM(CONFIG.SLACK_OWNER_USER_ID, message);
    }
    
    // Also notify operations
    await slackAPI.sendDM(CONFIG.SLACK_OPERATIONS_USER_ID, message);
    
    console.log(`✅ Critical error notification sent for ${person.name}`);
    
  } catch (notificationError) {
    console.error('❌ Failed to send critical error notification:', notificationError);
  }
}

// Notification functions
async function sendPipelineDetectionFailure(person, stage, assignedUserId) {
  try {
    // Get assigned user info
    let assignedUser = null;
    try {
      assignedUser = await fubAPI.get(`/users/${assignedUserId}`);
    } catch (error) {
      console.error(`❌ Failed to get assigned user ${assignedUserId}:`, error.message);
    }
    
    const slackUserId = assignedUser?.slackUserId; // Assuming this field exists
    
    const message = `🚨 *Pipeline Detection Failed*
    
*Contact:* ${person.name}
*Stage Updated To:* ${stage}
*Contact ID:* ${person.id}

We tried to update the contact stage but couldn't figure out which pipeline it's in. Please take a moment to review the contact and specify which pipeline the client is in.

*Contact Link:* https://align.followupboss.com/2/people/view/${person.id}

Let us know if you have any questions!`;

    // Send to assigned user if we have their Slack ID
    if (slackUserId) {
      await slackAPI.sendDM(slackUserId, message);
      console.log(`✅ Pipeline detection failure notification sent to assigned user ${assignedUserId}`);
    } else {
      console.log(`⚠️ No Slack user ID found for assigned user ${assignedUserId}`);
    }
    
    // Also notify operations
    await slackAPI.sendDM(CONFIG.SLACK_OPERATIONS_USER_ID, message);
    console.log(`✅ Pipeline detection failure notification sent to operations`);
    
  } catch (error) {
    console.error('❌ Failed to send pipeline detection failure notification:', error);
  }
}

async function sendDuplicateDealsWarning(person, pipelineTag, deals) {
  try {
    const message = `⚠️ *Duplicate Deals Warning*
    
*Contact:* ${person.name}
*Contact ID:* ${person.id}
*Pipeline:* ${pipelineTag}

AIDA found multiple deals on that pipeline. Please review the deals on that contact. If one is stage "Closed" and the other is in an active stage, please update the active deal stage. If there are duplicates, please condense and ensure the remaining deal gets updated to the correct stage.

*Contact Link:* https://align.followupboss.com/2/people/view/${person.id}

*Deals Found:*
${deals.map(deal => `• Deal ID: ${deal.id} - Stage: ${deal.stage}`).join('\n')}

Thanks!`;

    await slackAPI.sendDM(CONFIG.SLACK_OPERATIONS_USER_ID, message);
    console.log(`✅ Duplicate deals warning sent for ${person.name}`);
    
  } catch (error) {
    console.error('❌ Failed to send duplicate deals warning:', error);
  }
}

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// Start server
app.listen(CONFIG.PORT, () => {
  console.log(`FUB Contact-to-Deal Sync server running on port ${CONFIG.PORT}`);
});

module.exports = app;
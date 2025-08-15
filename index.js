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
  COMMERCIAL_PIPELINE_ID: null // We need to find the correct ID
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

      // Only add assignee if GID is provided
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

  // Test connection and permissions
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
  
  // Not active if stage contains "closed"
  if (dealStage.includes('closed')) {
    return false;
  }
  
  // Not active if in protected stages
  if (STAGE_MAPPING.protectedStages.some(stage => 
    dealStage.includes(normalize(stage)))) {
    return false;
  }
  
  return true;
};

// Enhanced Stage mapping configuration
const STAGE_MAPPING = {
  // Stages to preserve when deleting deals
  protectedStages: [
    "offer rejected", "client not taken", "working with another agent", 
    "fall through", "expired", "cancelled", "listing agreement", 
    "pre-listing", "active listing", "active off-market", 
    "application accepted", "attorney review", "under contract", 
    "showing homes", "offers submitted", "submitting applications"
  ],
  
  // Pipelines to never delete deals from
  protectedPipelines: [
    "agent recruiting", "outgoing referral"
  ],
  
  // Deletion trigger stages
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
  // Note: Commercial (ID: 5) is detected by stage prefix, not tags
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

// Enhanced deal deletion logic
const shouldDeleteDeal = (deal, contactStage, availableStageNames) => {
  const dealStage = normalize(deal.stage || '');
  const pipelineName = normalize(deal.pipelineName || '');
  let updatedStage = normalize(contactStage);
  
  // For Commercial stages, remove the prefix before checking
  if (contactStage.toLowerCase().startsWith('commercial - ')) {
    updatedStage = normalize(contactStage.substring(13)); // Remove "COMMERCIAL - "
  }
  
  // Don't delete from protected pipelines
  if (STAGE_MAPPING.protectedPipelines.some(pipeline => 
    pipelineName.includes(normalize(pipeline)))) {
    console.log(`🛡️ Deal ${deal.id} in protected pipeline: ${pipelineName}`);
    return false;
  }
  
  // Don't delete if deal stage contains "closed"
  if (dealStage.includes('closed')) {
    console.log(`🛡️ Deal ${deal.id} is closed: ${dealStage}`);
    return false;
  }
  
  // Don't delete protected stages
  if (STAGE_MAPPING.protectedStages.some(stage => 
    dealStage.includes(normalize(stage)))) {
    console.log(`🛡️ Deal ${deal.id} in protected stage: ${dealStage}`);
    return false;
  }
  
  // Delete if contact stage is a deletion trigger AND
  // the contact stage doesn't match any known deal stages
  if (STAGE_MAPPING.deletionStages.includes(updatedStage)) {
    console.log(`🗑️ Deal ${deal.id} marked for deletion: contact in deletion stage "${updatedStage}"`);
    return true;
  }
  
  // Delete if contact stage doesn't match any available deal stages
  const normalizedAvailableStages = availableStageNames.map(normalize);
  if (!normalizedAvailableStages.includes(updatedStage)) {
    console.log(`🗑️ Deal ${deal.id} marked for deletion: contact stage "${updatedStage}" not found in pipeline stages`);
    console.log(`📋 Available normalized stages: ${normalizedAvailableStages.join(', ')}`);
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
  
  // Find the stage ID by matching stage name
  const index = namesArray.indexOf(inputName);
  const matchedId = index !== -1 ? idsArray[index] : "0";
  
  console.log(`🎯 Stage mapping: "${inputName}" → Stage ID: ${matchedId}`);
  console.log(`📋 Available stages: ${namesArray.join(', ')}`);
  console.log(`🔢 Available stage IDs: ${idsArray.join(', ')}`);
  
  let shouldCreateDeal = "no";
  let shouldUpdateDeal = "no";
  let skipUpdate = "no";
  
  // Decision logic
  if (dealIdsArray.length === 0) {
    // No deals at all → Create
    shouldCreateDeal = "yes";
    console.log(`✅ Decision: CREATE (no existing deals)`);
  } else if (dealIdsArray.length > 1) {
    // Multiple deals → Skip
    skipUpdate = "yes";
    console.log(`⚠️ Decision: SKIP (multiple deals: ${dealIdsArray.length})`);
  } else {
    // One deal → check if it matches or update
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
  // No special formatting needed for Buyer pipeline anymore
  return stageName;
};

// Format commercial stages by removing prefix
const formatStageForCommercial = (contactStage) => {
  // Contact stage has "COMMERCIAL - " prefix, remove it for deal stage
  if (contactStage.toLowerCase().startsWith('commercial - ')) {
    return contactStage.substring(13); // Remove "COMMERCIAL - " (13 characters)
  }
  return contactStage; // No prefix found, return as-is
};

// Helper function to check if a stage exists in any pipeline (i.e., is a valid deal stage)
const isValidDealStage = async (stageName) => {
  try {
    const normalizedStage = normalize(stageName);
    
    // Check if it's a commercial stage
    if (stageName.toLowerCase().startsWith('commercial - ')) {
      const formattedStage = formatStageForCommercial(stageName);
      const allPipelines = await fubAPI.get('/pipelines');
      const commercialPipeline = allPipelines.pipelines?.find(p => 
        p.name && p.name.toLowerCase().includes('commercial')
      );
      if (commercialPipeline) {
        const pipelineStages = await fubAPI.get(`/pipelines/${commercialPipeline.id}`);
        const stageNames = pipelineStages.stages?.map(s => normalize(s.name)) || [];
        return stageNames.includes(normalize(formattedStage));
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
        console.error(`❌ Failed to check pipeline ${pipelineId}:`, error.message);
      }
    }
    
    return false;
  } catch (error) {
    console.error('❌ Failed to validate deal stage:', error.message);
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
    
    if (stageResult.stageId === "0") {
      console.log(`❌ Stage "${formattedStage}" not found in pipeline ${pipelineName}`);
      return { success: false, reason: 'stage_not_found', pipeline: pipelineName, stage: formattedStage };
    }
    
    // Update the deal
    const updatePayload = { stageId: parseInt(stageResult.stageId) };
    await fubAPI.put(`/deals/${deal.id}`, updatePayload);
    
    console.log(`✅ Updated existing deal ${deal.id} to stage "${formattedStage}" (ID: ${stageResult.stageId})`);
    return { success: true, dealId: deal.id, stageId: parseInt(stageResult.stageId), pipeline: pipelineName };
    
  } catch (error) {
    console.error(`❌ Failed to update existing deal ${deal.id}:`, error.message);
    return { success: false, reason: 'update_failed', error: error.message };
  }
};

// Main webhook handler
app.post('/webhook/person-stage-updated', async (req, res) => {
  let person = null; // Declare in function scope
  let assignedUserId = null;
  
  try {
    // Log the entire webhook payload for debugging
    console.log('=== WEBHOOK RECEIVED ===');
    console.log('Body:', JSON.stringify(req.body, null, 2));
    console.log('========================');
    
    // FUB webhook structure: { event, resourceIds, data: { stage }, uri }
    const { event, resourceIds, data, uri, eventId } = req.body;
    
    // Deduplication check
    if (eventId && processedEvents.has(eventId)) {
      console.log(`🔄 Duplicate event detected: ${eventId} - skipping`);
      return res.json({ success: true, message: 'Duplicate event ignored' });
    }
    
    if (event !== 'peopleStageUpdated' || !resourceIds || !data || !data.stage) {
      console.log('❌ Invalid webhook payload structure');
      return res.status(400).json({ error: 'Invalid webhook payload' });
    }
    
    // Mark event as processed
    if (eventId) {
      processedEvents.set(eventId, Date.now());
    }
    
    const personId = resourceIds[0];
    const stage = data.stage;
    
    console.log(`✅ Processing stage update for Person ID ${personId}: ${stage}`);
    
    // Get the full person data from FUB API
    console.log(`🔍 Fetching person data from FUB API for ID: ${personId}`);
    
    const personData = await fubAPI.get(`/people/${personId}`);
    
    if (!personData || !personData.id) {
      console.log('❌ No person data in FUB API response');
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
    
    console.log(`✅ Retrieved person: ${person.name} (ID: ${person.id})`);
    console.log(`👤 Assigned User ID: ${assignedUserId}`);
    console.log(`🏷️ Person Tags: ${person.tags?.join(', ') || 'None'}`);
    console.log(`📊 New Stage: ${stage}`);
    
    // Step 1: Get all existing deals for this person
    console.log(`📊 Fetching all deals for person ${personId}...`);
    const allDeals = await fubAPI.get(`/deals?personId=${personId}`);
    console.log(`✅ Found ${allDeals.deals?.length || 0} existing deals`);
    
    // Step 2: Extract pipeline information from tags OR detect Commercial from stage
    let pipelineTags = [];
    let isCommercialStage = false;
    
    // Check if this is a commercial stage (starts with "COMMERCIAL - ")
    if (stage.toLowerCase().startsWith('commercial - ')) {
      console.log(`🏢 Commercial stage detected: ${stage}`);
      pipelineTags = ['Commercial'];
      isCommercialStage = true;
    } else {
      // Regular tag-based pipeline detection (excludes Commercial)
      pipelineTags = extractPipelineFromTags(person.tags);
      console.log(`🏷️ Extracted pipeline tags from [${person.tags?.join(', ') || 'None'}]: [${pipelineTags.join(', ')}]`);
    }
    
    // Step 3: Enhanced pipeline logic based on stage matching (MOVED UP)
    if (pipelineTags.length === 0) {
      // Check if there's exactly one existing deal - if so, update it instead of sending notification
      if (allDeals.deals && allDeals.deals.length === 1) {
        console.log('🎯 No pipeline tags detected but exactly one deal exists - attempting to update it');
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
            console.log(`ℹ️ Stage "${stage}" is not a deal stage - no action required`);
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
          console.log(`ℹ️ Stage "${stage}" is not a valid deal stage in any pipeline - no action required`);
          return res.json({ success: true, message: 'Non-deal stage, no action required' });
        }
        
        // Only send notification if it's a valid deal stage but no pipeline tags detected
        console.log('❌ Valid deal stage detected but no pipeline tags - sending notification');
        await sendPipelineDetectionFailure(person, stage, assignedUserId, pipelineTags);
        return res.json({ success: true, message: 'Valid deal stage but no pipeline tags detected, notification sent' });
      } else {
        console.log('❌ No pipeline tags detected but multiple existing deals found - proceeding with deletion logic');
        // Continue to deletion logic below - let it handle the existing deals
      }
    }
    else {
      // If we have pipeline tags, check stage matching
      // Check which pipelines the contact stage actually matches
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
            console.error('❌ Failed to fetch Commercial pipeline:', error.message);
            continue;
          }
        } else {
          testPipelineId = PIPELINE_MAPPING[pipelineTag];
          formattedStage = formatStageForBuyer(pipelineTag, stage);
        }
        
        if (!testPipelineId) continue;
        
        // Get stages for this pipeline and check if contact stage matches
        try {
          const pipelineStages = await fubAPI.get(`/pipelines/${testPipelineId}`);
          const stageNames = pipelineStages.stages?.map(s => s.name.toLowerCase()) || [];
          
          if (stageNames.includes(formattedStage.toLowerCase())) {
            matchingPipelines.push({
              tag: pipelineTag,
              id: testPipelineId,
              formattedStage: formattedStage
            });
            console.log(`✅ Stage "${formattedStage}" found in ${pipelineTag} pipeline`);
          } else {
            console.log(`❌ Stage "${formattedStage}" not found in ${pipelineTag} pipeline`);
          }
        } catch (error) {
          console.error(`❌ Failed to check ${pipelineTag} pipeline:`, error.message);
        }
      }
      
      // Decision logic based on matching pipelines
      if (matchingPipelines.length === 0) {
        console.log('❌ Contact stage matches no pipeline stages - proceed with deletion logic');
        // Continue to deletion logic below - don't process single pipeline logic
      } else if (matchingPipelines.length > 1) {
        console.log('❌ Contact stage matches multiple pipeline stages - sending notification');
        await sendPipelineDetectionFailure(person, stage, assignedUserId, pipelineTags);
        return res.json({ success: true, message: 'Stage matches multiple pipelines, notification sent' });
      } else {
        // Single matching pipeline - skip deletion and go straight to deal management
        const selectedPipeline = matchingPipelines[0];
        const pipelineTag = selectedPipeline.tag;
        const pipelineId = selectedPipeline.id;
        const formattedStage = selectedPipeline.formattedStage;
        
        console.log(`🎯 Using pipeline: ${pipelineTag} (ID: ${pipelineId}) for stage "${formattedStage}"`);
        
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
        
        if (stageResult.stageId === "0") {
          await sendCriticalError(person, stage, `Stage "${formattedStage}" not found in pipeline ${pipelineTag}`, null, pipelineTags);
          return res.json({ success: true, message: 'Stage not found in pipeline' });
        }
        
        // Handle deal creation/update
        if (stageResult.shouldCreateDeal === "yes") {
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
        
        if (stageResult.shouldUpdateDeal === "yes") {
          try {
            const dealId = existingDeals.deals[0].id;
            await fubAPI.put(`/deals/${dealId}`, { stageId: parseInt(stageResult.stageId) });
            return res.json({ 
              success: true, 
              message: 'Deal updated', 
              dealId: dealId,
              newStageId: parseInt(stageResult.stageId)
            });
          } catch (error) {
            await sendCriticalError(person, stage, `Failed to update deal: ${error.response?.data ? JSON.stringify(error.response.data) : error.message}`, error, pipelineTags);
            return res.status(500).json({ error: 'Failed to update deal' });
          }
        }
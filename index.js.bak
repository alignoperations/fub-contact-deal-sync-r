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
      // Only send notification if there are NO existing deals
      if (!allDeals.deals || allDeals.deals.length === 0) {
        console.log('❌ No pipeline tags detected and no existing deals - sending notification');
        await sendPipelineDetectionFailure(person, stage, assignedUserId, pipelineTags);
        return res.json({ success: true, message: 'No pipeline tags detected, notification sent' });
      } else {
        console.log('❌ No pipeline tags detected but existing deals found - proceeding with deletion logic');
        // Continue to deletion logic below - let it handle the existing deals
      }
    }
    } else {
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
        // Continue to deletion logic below
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
        
        return res.json({ success: true, message: 'Deal processing complete' });
      }
    }
    
    // Step 4: Enhanced deal deletion logic (only runs if no stage matches found)
    if (allDeals.deals && allDeals.deals.length > 0) {
      const dealsToDelete = [];
      
      for (const deal of allDeals.deals) {
        // Get available stages for this deal's pipeline to check if contact stage matches
        let availableStageNames = [];
        try {
          const pipelineStages = await fubAPI.get(`/pipelines/${deal.pipelineId}`);
          availableStageNames = pipelineStages.stages?.map(s => s.name) || [];
        } catch (error) {
          console.error(`❌ Failed to get stages for pipeline ${deal.pipelineId}:`, error.message);
        }
        
        if (shouldDeleteDeal(deal, stage, availableStageNames)) {
          dealsToDelete.push(deal);
        }
      }
      
      // Delete the marked deals
      for (const deal of dealsToDelete) {
        try {
          console.log(`🗑️ Deleting deal ${deal.id} (${deal.stage} in ${deal.pipelineName})`);
          await fubAPI.delete(`/deals/${deal.id}`);
          console.log(`✅ Successfully deleted deal ${deal.id}`);
        } catch (error) {
          console.error(`❌ Failed to delete deal ${deal.id}:`, error.message);
          await sendCriticalError(person, stage, `Failed to delete deal ${deal.id}`, error, pipelineTags);
        }
      }
      
      if (dealsToDelete.length > 0) {
        console.log(`✅ Deletion complete. Deleted ${dealsToDelete.length} deals`);
        // Removed Slack notification - only log to console for successful deletions
        return res.json({ 
          success: true, 
          message: `Deleted ${dealsToDelete.length} deals`,
          deletedDeals: dealsToDelete.map(d => d.id)
        });
      }
    }
    
    // Step 5: Handle remaining scenarios for single pipeline tags
    const pipelineTag = pipelineTags[0];
    let pipelineId;
    
    if (pipelineTag === 'Commercial') {
      try {
        const allPipelines = await fubAPI.get('/pipelines');
        const commercialPipeline = allPipelines.pipelines?.find(p => 
          p.name && p.name.toLowerCase().includes('commercial')
        );
        if (commercialPipeline) {
          pipelineId = commercialPipeline.id;
        } else {
          await sendCriticalError(person, stage, 'Commercial pipeline not found', null, pipelineTags);
          return res.json({ success: true, message: 'Commercial pipeline not found' });
        }
      } catch (error) {
        await sendCriticalError(person, stage, 'Failed to fetch pipelines', error, pipelineTags);
        return res.json({ success: true, message: 'Failed to fetch pipelines' });
      }
    } else {
      pipelineId = PIPELINE_MAPPING[pipelineTag];
    }
    
    if (!pipelineId) {
      await sendPipelineDetectionFailure(person, stage, assignedUserId, pipelineTags);
      return res.json({ success: true, message: 'Unknown pipeline tag, notification sent' });
    }
    
    console.log(`🎯 Using single pipeline: ${pipelineTag} (ID: ${pipelineId})`);
    
    // Get pipeline stages
    const pipelineStages = await fubAPI.get(`/pipelines/${pipelineId}`);
    let formattedStage = stage;
    if (pipelineTag === "Commercial") {
      formattedStage = formatStageForCommercial(stage);
    }
    
    // Get existing deals for this person and specific pipeline
    const existingDeals = await fubAPI.get(`/deals?pipelineId=${pipelineId}&personId=${personId}`);
    
    // Check for duplicate active deals in this pipeline
    if (existingDeals.deals && existingDeals.deals.length > 0) {
      const activeDeals = existingDeals.deals.filter(isDealActive);
      console.log(`📊 Active deals in ${pipelineTag} pipeline: ${activeDeals.length}`);
      
      if (activeDeals.length > 1) {
        console.log(`⚠️ Multiple active deals detected in ${pipelineTag} pipeline - creating Asana task`);
        await createDuplicateDealsTask(person, stage, pipelineTag, activeDeals);
      }
    }
    
    // Find the stage ID
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
    
    // Step 6: Handle deal creation/update based on logic
    if (stageResult.shouldCreateDeal === "yes") {
      try {
        const createPayload = {
          name: person.name || 'Untitled Deal',    // Deal name (required)
          stageId: parseInt(stageResult.stageId),  // Stage ID (required)
          peopleIds: [parseInt(personId)],         // Array of person IDs
          userIds: [parseInt(assignedUserId)]      // Array of user IDs
        };
        console.log(`🆕 Creating deal with payload:`, createPayload);
        
        const newDeal = await fubAPI.post('/deals', createPayload);
        
        console.log(`✅ Created deal ${newDeal.id} for ${person.name}`);
        return res.json({ 
          success: true, 
          message: 'Deal created', 
          dealId: newDeal.id,
          pipelineId: parseInt(pipelineId),
          stageId: parseInt(stageResult.stageId)
        });
      } catch (error) {
        console.error(`❌ Failed to create deal:`, error.message);
        console.error(`❌ Error response:`, error.response?.data);
        console.error(`❌ Error status:`, error.response?.status);
        await sendCriticalError(person, stage, `Failed to create deal: ${error.response?.data ? JSON.stringify(error.response.data) : error.message}`, error, pipelineTags);
        return res.status(500).json({ error: 'Failed to create deal' });
      }
    }
    
    if (stageResult.shouldUpdateDeal === "yes") {
      try {
        const dealId = existingDeals.deals[0].id;
        const updatePayload = { stageId: parseInt(stageResult.stageId) };
        console.log(`🔄 Updating deal ${dealId} with:`, updatePayload);
        
        await fubAPI.put(`/deals/${dealId}`, updatePayload);
        
        console.log(`✅ Updated deal ${dealId} for ${person.name}`);
        return res.json({ 
          success: true, 
          message: 'Deal updated', 
          dealId: dealId,
          newStageId: parseInt(stageResult.stageId)
        });
      } catch (error) {
        console.error(`❌ Failed to update deal:`, error.message);
        await sendCriticalError(person, stage, `Failed to update deal`, error, pipelineTags);
        return res.status(500).json({ error: 'Failed to update deal' });
      }
    }
    
    if (stageResult.skipUpdate === "yes") {
      console.log(`⚠️ Multiple deals detected, sending notification`);
      await sendDuplicateDealsWarning(person, pipelineTag, existingDeals.deals);
      return res.json({ success: true, message: 'Multiple deals detected, notification sent' });
    }
    
    console.log(`ℹ️ No action required for ${person.name}`);
    return res.json({ success: true, message: 'No action required' });
    
  } catch (error) {
    console.error('❌ Critical webhook error:', error);
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
        return res.json({ 
          success: true, 
          message: 'Deal created', 
          dealId: newDeal.id,
          pipelineId: parseInt(pipelineId),
          stageId: parseInt(stageResult.stageId)
        });
      } catch (error) {
        console.error(`❌ Failed to create deal:`, error.message);
        console.error(`❌ Error response:`, error.response?.data);
        console.error(`❌ Error status:`, error.response?.status);
        await sendCriticalError(person, stage, `Failed to create deal: ${error.response?.data ? JSON.stringify(error.response.data) : error.message}`, error, pipelineTags);
        return res.status(500).json({ error: 'Failed to create deal' });
      }
    }
    
    if (stageResult.shouldUpdateDeal === "yes") {
      try {
        const dealId = existingDeals.deals[0].id;
        const updatePayload = { stageId: parseInt(stageResult.stageId) };
        console.log(`🔄 Updating deal ${dealId} with:`, updatePayload);
        
        await fubAPI.put(`/deals/${dealId}`, updatePayload);
        
        console.log(`✅ Updated deal ${dealId} for ${person.name}`);
        return res.json({ 
          success: true, 
          message: 'Deal updated', 
          dealId: dealId,
          newStageId: parseInt(stageResult.stageId)
        });
      } catch (error) {
        console.error(`❌ Failed to update deal:`, error.message);
        await sendCriticalError(person, stage, `Failed to update deal`, error, pipelineTags);
        return res.status(500).json({ error: 'Failed to update deal' });
      }
    }
    
    if (stageResult.skipUpdate === "yes") {
      console.log(`⚠️ Multiple deals detected, sending notification`);
      await sendDuplicateDealsWarning(person, pipelineTag, existingDeals.deals);
      return res.json({ success: true, message: 'Multiple deals detected, notification sent' });
    }
    
    console.log(`ℹ️ No action required for ${person.name}`);
    return res.json({ success: true, message: 'No action required' });
    
  } catch (error) {
    console.error('❌ Critical webhook error:', error);
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
    const errorDetails = error ? `\nError: ${error.message}\nStack: ${error.stack?.substring(0, 500)}` : '';
    const pipelineInfo = pipelineTags.length > 0 ? `\n*Detected Pipeline Tags:* ${pipelineTags.join(', ')}` : '\n*Detected Pipeline Tags:* None';
    
    const message = `🚨 *CRITICAL ERROR - FUB Contact-Deal Sync*
    
*Contact:* ${person.name}
*Contact ID:* ${person.id}
*Stage:* ${stage}${pipelineInfo}
*Error:* ${errorMessage}
${errorDetails}

*Contact Link:* https://align.followupboss.com/2/people/view/${person.id}

This requires immediate attention. The automation failed to process this contact properly.`;

    // Send to notifications channel
    if (CONFIG.SLACK_NOTIFICATIONS_CHANNEL_ID) {
      await slackAPI.sendChannelMessage(CONFIG.SLACK_NOTIFICATIONS_CHANNEL_ID, message);
      console.log(`✅ Critical error notification sent to channel ${CONFIG.SLACK_NOTIFICATIONS_CHANNEL_ID}`);
    }
    
  } catch (notificationError) {
    console.error('❌ Failed to send critical error notification:', notificationError);
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
          console.log(`✅ Pipeline detection failure notification sent to assigned user via Slack`);
          return; // Successfully sent to agent, no need for channel notification
        }
      }
    } catch (error) {
      console.log(`⚠️ Could not notify assigned user ${assignedUserId} directly`);
    }
    
    // Fallback: Send to notifications channel
    if (CONFIG.SLACK_NOTIFICATIONS_CHANNEL_ID) {
      const channelMessage = `📋 *Pipeline Detection Needed*

*Contact:* ${person.name} (ID: ${person.id})
*Stage:* ${stage}
*Assigned User:* ${assignedUserId}

${message}`;
      
      await slackAPI.sendChannelMessage(CONFIG.SLACK_NOTIFICATIONS_CHANNEL_ID, channelMessage);
      console.log(`✅ Pipeline detection failure notification sent to channel`);
    }
    
  } catch (error) {
    console.error('❌ Failed to send pipeline detection failure notification:', error);
  }
}

// Helper function to find Slack user by email (borrowed from your automation.js)
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
    console.log(`✅ Created Asana task ${task.data.gid} for duplicate deals`);
    
  } catch (error) {
    console.error('❌ Failed to create Asana task for duplicate deals:', error);
    
    // Send Slack notification as fallback
    try {
      const fallbackMessage = `⚠️ *Asana Task Creation Failed*
      
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
      console.error('❌ Failed to send fallback Slack notification:', slackError);
    }
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

    if (CONFIG.SLACK_NOTIFICATIONS_CHANNEL_ID) {
      await slackAPI.sendChannelMessage(CONFIG.SLACK_NOTIFICATIONS_CHANNEL_ID, message);
      console.log(`✅ Duplicate deals warning sent for ${person.name}`);
    }
    
  } catch (error) {
    console.error('❌ Failed to send duplicate deals warning:', error);
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
  console.log(`- FUB API Key: ${CONFIG.FUB_API_KEY ? '✅ Set' : '❌ Missing'}`);
  console.log(`- Slack Bot Token: ${CONFIG.SLACK_BOT_TOKEN ? '✅ Set' : '❌ Missing'}`);
  console.log(`- Asana Access Token: ${CONFIG.ASANA_ACCESS_TOKEN ? '✅ Set' : '❌ Missing'}`);
  console.log(`- Operations User ID: ${CONFIG.SLACK_OPERATIONS_USER_ID ? '✅ Set' : '❌ Missing'}`);
  console.log(`- Owner User ID: ${CONFIG.SLACK_OWNER_USER_ID ? '✅ Set' : '❌ Missing'}`);
  console.log(`- Asana Project ID: ${CONFIG.ASANA_PROJECT_ID ? '✅ Set' : '❌ Missing'}`);
  console.log(`- Asana Assignee GID: ${CONFIG.ASANA_ASSIGNEE_GID ? '✅ Set' : '❌ Missing'}`);
});

module.exports = app;
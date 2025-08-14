# FUB Contact-to-Deal Sync Automation

A sophisticated automation system that manages FollowUpBoss deals based on contact stage changes. This system handles creating, updating, and deleting deals while providing intelligent error handling and notifications via Slack and Asana.

## Features

### 🔄 Bidirectional Sync
- Automatically creates deals when contacts enter active stages
- Updates existing deals when contact stages change
- Deletes deals when contacts move to incompatible stages

### 🧠 Intelligent Pipeline Detection
- Extracts pipeline information from contact tags
- Supports multiple pipeline types: Buyer, Seller/Listing, Landlord, Tenant, Commercial
- Handles complex tag-based pipeline mapping
- Automatic Commercial pipeline detection via stage prefix

### 🎯 Smart Deal Management
- **Create**: New deals for contacts without existing deals
- **Update**: Existing deals when stages change
- **Delete**: Deals that no longer match active criteria with enhanced protection rules
- **Skip**: Multiple deals (requires manual review via Asana)

### 🚨 Error Handling & Notifications
- Pipeline detection failures with Jotform integration
- Duplicate deal warnings via Asana tasks
- Stage mapping issues
- Critical error notifications to owner
- All notifications sent via Slack DMs

### 📊 Advanced Logic
- Enhanced deal deletion protection (preserves closed, protected stages)
- Handles multiple pipeline scenarios
- Complex stage mapping and validation
- Robust filtering and safety checks
- Event deduplication to prevent double-processing

### 📋 Asana Integration
- Automatic task creation for duplicate deal detection
- Assigned to operations team
- Detailed context and resolution instructions

## Installation

```bash
# Clone the repository
git clone <repository-url>
cd fub-contact-deal-sync

# Install dependencies
npm install

# Copy environment variables
cp .env.example .env

# Edit .env with your configuration
nano .env
```

## Configuration

### Required Environment Variables

```bash
# FollowUpBoss API
FUB_API_KEY=your_api_key_here

# Slack Configuration
SLACK_BOT_TOKEN=xoxb-your-bot-token
SLACK_OPERATIONS_USER_ID=U1234567890  # operations@alignteam.com
SLACK_OWNER_USER_ID=U0987654321       # Your user ID for critical errors

# Asana Configuration
ASANA_ACCESS_TOKEN=your_asana_token_here
ASANA_PROJECT_ID=your_project_id_here

# Server
PORT=3000
```

### Pipeline Mapping

The system uses the following pipeline mappings:

```javascript
{
  'Seller': 2,
  'Buyer': 1, 
  'Landlord': 3,
  'Tenant': 4,
  'Listing': 2,
  // Commercial: 5 (detected by stage prefix, not tags)
}
```

### Enhanced Deal Protection Rules

Protected stages (never deleted):
- `offer rejected`, `client not taken`, `working with another agent`
- `fall through`, `expired`, `cancelled`, `listing agreement`
- `pre-listing`, `active listing`, `active off-market`
- `application accepted`, `attorney review`, `under contract`
- `showing homes`, `offers submitted`, `submitting applications`
- Any stage containing `closed`

Protected pipelines (never delete deals from):
- `agent recruiting`, `outgoing referral`

## Usage

### Start the Server

```bash
# Production
npm start

# Development with auto-reload
npm run dev
```

### Webhook Setup

Configure FollowUpBoss to send webhooks to:
```
POST /webhook/person-stage-updated
```

### Expected Webhook Payload

```json
{
  "eventId": "12345-67890-abcdef",
  "event": "peopleStageUpdated",
  "resourceIds": [368564],
  "data": {
    "stage": "Spoke with customer"
  }
}
```

## How It Works

### 1. Event Deduplication
- Prevents duplicate processing using event IDs
- 5-minute cleanup cycle for memory management

### 2. Pipeline Detection
- **Tag-based**: Extracts pipeline from contact tags (Buyer, Seller, Landlord, Tenant)
- **Stage-based**: Commercial pipeline detected by "COMMERCIAL - " prefix
- **Multiple pipelines**: Sends notification for manual resolution

### 3. Enhanced Deal Deletion Logic
- Smart deletion based on stage compatibility
- Comprehensive protection rules
- Cross-pipeline deal analysis

### 4. Deal Management
- **No existing deals**: Creates new deal with proper stage mapping
- **One existing deal**: Updates stage if mapping exists
- **Multiple active deals**: Creates Asana task for manual review

### 5. Notifications & Tasks
- **Pipeline failures**: Slack DM with Jotform link
- **Duplicate deals**: Asana task assignment
- **Critical errors**: Immediate Slack notification to owner
- **Stage mapping issues**: Detailed error context

## API Endpoints

### POST /webhook/person-stage-updated
Main webhook handler for person stage updates with full deduplication and error handling.

### GET /health
Health check endpoint.

## Error Handling

The system includes comprehensive error handling:

- **Pipeline Detection Failures**: When tags don't clearly indicate a pipeline
- **Duplicate Active Deals**: When multiple non-closed deals exist for same pipeline
- **Stage Mapping Issues**: When stages don't exist in the target pipeline
- **API Failures**: Graceful handling of FUB/Slack/Asana API errors
- **Critical System Errors**: Immediate notification to technical owner

## Integrations

### Slack Notifications

**Pipeline Detection Failure:**
```
Hi! We tried to update the contact for John Doe for you when you updated the contact stage to Lead but we couldn't figure out which pipeline it's in. Please take a moment to click here and let us know which pipeline the client is in and we'll generate the deal card for you.

-AIDA
```

**Critical Error (to Owner):**
```
🚨 CRITICAL ERROR - FUB Contact-Deal Sync

Contact: John Doe
Contact ID: 368564
Stage: Lead
Detected Pipeline Tags: Buyer, Seller
Error: Failed to create deal

This requires immediate attention...
```

### Asana Task Creation

**Duplicate Deals:**
- **Title**: "Duplicate Deals Detected - {contact_id}"
- **Assigned**: cadesanya@alignteam.com
- **Description**: Detailed context with FUB links and resolution steps

## Commercial Pipeline

### Special Handling
- **Detection**: Automatic via "COMMERCIAL - " stage prefix
- **Stage Mapping**: "COMMERCIAL - Lead" → Deal stage: "Lead"
- **No Tag Required**: Bypasses normal tag-based pipeline detection

### Examples
- Contact stage: "COMMERCIAL - Under Contract" → Deal stage: "Under Contract"
- Contact stage: "COMMERCIAL - Closed" → Deal stage: "Closed"

## Testing

```bash
# Run tests
npm test

# Run tests in watch mode
npm run test:watch
```

## Deployment

### Environment Setup
1. Set up environment variables
2. Configure Slack bot permissions
3. Set up Asana project and access token
4. Set up FUB webhook endpoints
5. Deploy to your preferred hosting platform

### Webhook Configuration
In FollowUpBoss, configure webhooks for:
- Person stage updates
- Point to: `https://your-domain.com/webhook/person-stage-updated`

## Monitoring

The system logs all actions with emoji-coded severity:
- ✅ Successful operations
- ⚠️ Warnings requiring attention
- ❌ Errors with automatic notifications
- 🔍 Debug information for troubleshooting

## Security

- API keys stored in environment variables
- Webhook payload validation and deduplication
- Secure Slack and Asana API integration
- Error logging without sensitive data exposure
- Event processing safeguards

## Support

For issues or questions:
1. Check Heroku logs for error details
2. Verify webhook configuration in FUB
3. Test API connectivity for all integrations
4. Review Slack bot and Asana permissions
5. Check critical error notifications in Slack

## License

MIT License - see LICENSE file for details.
\# FUB Contact-to-Deal Sync Automation



A sophisticated automation system that manages FollowUpBoss deals based on contact stage changes. This system handles creating, updating, and deleting deals while providing intelligent error handling and notifications via Slack.



\## Features



\### 🔄 Bidirectional Sync

\- Automatically creates deals when contacts enter active stages

\- Updates existing deals when contact stages change

\- Deletes deals when contacts move to nurture/inactive stages



\### 🧠 Intelligent Pipeline Detection

\- Extracts pipeline information from contact tags

\- Supports multiple pipeline types: Buyer, Seller/Listing, Landlord, Tenant

\- Handles complex tag-based pipeline mapping



\### 🎯 Smart Deal Management

\- \*\*Create\*\*: New deals for contacts without existing deals

\- \*\*Update\*\*: Existing deals when stages change

\- \*\*Delete\*\*: Deals that no longer match active criteria

\- \*\*Skip\*\*: Multiple deals (requires manual review)



\### 🚨 Error Handling \& Notifications

\- Pipeline detection failures

\- Duplicate deal warnings

\- Stage mapping issues

\- All notifications sent via Slack DMs



\### 📊 Advanced Logic

\- Preserves "always keep" stages (closed deals)

\- Handles multiple pipeline scenarios

\- Complex stage mapping and validation

\- Robust filtering and safety checks



\## Installation



```bash

\# Clone the repository

git clone <repository-url>

cd fub-contact-deal-sync



\# Install dependencies

npm install



\# Copy environment variables

cp .env.example .env



\# Edit .env with your configuration

nano .env

```



\## Configuration



\### Required Environment Variables



```bash

\# FollowUpBoss API

FUB\_API\_KEY=your\_api\_key\_here



\# Slack Configuration

SLACK\_BOT\_TOKEN=xoxb-your-bot-token

SLACK\_OPERATIONS\_USER\_ID=U1234567890  # operations@alignteam.com



\# Server

PORT=3000

```



\### Pipeline Mapping



The system uses the following pipeline mappings:



```javascript

{

&nbsp; 'Seller': 2,

&nbsp; 'Buyer': 1, 

&nbsp; 'Landlord': 3,

&nbsp; 'Tenant': 4,

&nbsp; 'Listing': 2

}

```



\### Stage Preservation Rules



Certain stages are always preserved and never deleted:

\- `closed`, `2023 closed`, `2022 closed`, `2021 closed`

\- Active contract stages: `under contract`, `attorney review`

\- Listing stages: `active listing`, `active off-market`



\## Usage



\### Start the Server



```bash

\# Production

npm start



\# Development with auto-reload

npm run dev

```



\### Webhook Setup



Configure FollowUpBoss to send webhooks to:

```

POST /webhook/person-stage-updated

```



\### Expected Webhook Payload



```json

{

&nbsp; "person": {

&nbsp;   "id": 368564,

&nbsp;   "name": "John Doe",

&nbsp;   "tags": \["Buyer", "Hot Lead"]

&nbsp; },

&nbsp; "stage": "Spoke with customer",

&nbsp; "assignedUserId": 287

}

```



\## How It Works



\### 1. Stage Update Detection

\- Webhook receives person stage update

\- Determines if this is a SWC (Spoke with Customer) or Nurture stage change



\### 2. Deal Deletion Logic

\- For SWC/Nurture stages, checks existing deals

\- Deletes deals that don't match "always keep" criteria

\- Preserves closed deals and active contracts



\### 3. Pipeline Detection

\- Extracts pipeline tags from contact tags

\- Handles single vs multiple pipeline scenarios

\- Sends notifications for ambiguous cases



\### 4. Deal Management

\- \*\*No existing deals\*\*: Creates new deal

\- \*\*One existing deal\*\*: Updates stage

\- \*\*Multiple deals\*\*: Sends duplicate warning



\### 5. Notifications

All notifications are sent via Slack DM:

\- Pipeline detection failures

\- Duplicate deal warnings

\- Stage mapping issues



\## API Endpoints



\### POST /webhook/person-stage-updated

Main webhook handler for person stage updates.



\### GET /health

Health check endpoint.



\## Error Handling



The system includes comprehensive error handling:



\- \*\*Pipeline Detection Failures\*\*: When tags don't clearly indicate a pipeline

\- \*\*Duplicate Deals\*\*: When multiple deals exist for the same pipeline

\- \*\*Stage Mapping Issues\*\*: When stages don't exist in the target pipeline

\- \*\*API Failures\*\*: Graceful handling of FUB API errors



\## Slack Notifications



\### Pipeline Detection Failure

```

🚨 Pipeline Detection Failed



Contact: John Doe

Stage Updated To: Spoke with customer

Contact ID: 368564



We tried to update the contact stage but couldn't figure out which pipeline it's in...

```



\### Duplicate Deals Warning

```

⚠️ Duplicate Deals Warning



Contact: John Doe

Pipeline: Buyer



AIDA found multiple deals on that pipeline. Please review...

```



\## Testing



```bash

\# Run tests

npm test



\# Run tests in watch mode

npm run test:watch

```



\## Deployment



\### Environment Setup

1\. Set up environment variables

2\. Configure Slack bot permissions

3\. Set up FUB webhook endpoints

4\. Deploy to your preferred hosting platform



\### Webhook Configuration

In FollowUpBoss, configure webhooks for:

\- Person stage updates

\- Point to: `https://your-domain.com/webhook/person-stage-updated`



\## Monitoring



The system logs all actions and provides health checks:

\- Deal creations/updates/deletions

\- Pipeline detection results

\- Error conditions

\- Notification deliveries



\## Security



\- API keys stored in environment variables

\- Webhook payload validation

\- Secure Slack API integration

\- Error logging without sensitive data exposure



\## Support



For issues or questions:

1\. Check the logs for error details

2\. Verify webhook configuration

3\. Test API connectivity

4\. Review Slack bot permissions



\## License



MIT License - see LICENSE file for details.


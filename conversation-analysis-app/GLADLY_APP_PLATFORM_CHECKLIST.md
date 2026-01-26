# Gladly App Platform Configuration Checklist

A comprehensive guide to prevent common configuration issues when building Gladly App Platform applications.

---

## Table of Contents

1. [Pre-Development Checklist](#1-pre-development-checklist)
2. [File Naming Conventions](#2-file-naming-conventions)
3. [Template Variable Reference](#3-template-variable-reference)
4. [Data Flow Understanding](#4-data-flow-understanding)
5. [Common Pitfalls](#5-common-pitfalls)
6. [Validation Steps](#6-validation-steps)
7. [Testing Approach](#7-testing-approach)
8. [Deployment Checklist](#8-deployment-checklist)

---

## 1. Pre-Development Checklist

Before starting a new Gladly App Platform app:

### Initial Setup
- [ ] Install and configure `appcfg` CLI tool
- [ ] Set `GLADLY_APP_CFG_ROOT` environment variable
- [ ] Set `GLADLY_APP_CFG_HOST`, `GLADLY_APP_CFG_USER`, `GLADLY_APP_CFG_TOKEN` for deployment
- [ ] Use `appcfg init` to create the app folder structure
- [ ] Use `appcfg add data-pull` to scaffold data pull configurations (creates correct filenames!)
- [ ] Use `appcfg add ui-template` to scaffold UI templates

### Understand the Data Flow
```
External API Response
        |
        v
   .rawData (in response_transformation.gtpl)
        |
        v
   Transformed JSON Object
        |
        v
   .{fieldName} (in external_id.gtpl, external_parent_id.gtpl)
        |
        v
   UI Template (flexible.card)
```

---

## 2. File Naming Conventions

### CRITICAL: Use Exact Filenames

The Gladly App Platform expects **exact filenames**. Using incorrect names will cause silent failures.

| Purpose | CORRECT Filename | WRONG Examples |
|---------|-----------------|----------------|
| Request URL | `request_url.gtpl` | `request-url.gtpl`, `requestUrl.gtpl` |
| Response transform | `response_transformation.gtpl` | `response_transform.gtpl`, `responseTransformation.gtpl` |
| External ID | `external_id.gtpl` | `externalId.gtpl`, `external-id.gtpl` |
| External parent ID | `external_parent_id.gtpl` | `externalParentId.gtpl`, `parent_id.gtpl` |
| External updated at | `external_updated_at.gtpl` | `updatedAt.gtpl`, `external-updated-at.gtpl` |
| Request body | `request_body.gtpl` | `requestBody.gtpl`, `body.gtpl` |
| Config | `config.json` | `configuration.json`, `settings.json` |
| UI Card | `flexible.card` | `card.xml`, `template.card` |

### Prevention Strategy

**ALWAYS use `appcfg add` commands** to create files:

```bash
# Creates data/pull/{name}/ with ALL correctly named files
appcfg add data-pull {name} -t {data_type} -v {version} -m GET

# Creates ui/templates/{name}/ with correctly named files
appcfg add ui-template {name} -t {GraphQLType}
```

---

## 3. Template Variable Reference

### Understanding Template Context by File

Each template file operates in a **different context** with access to different variables:

#### request_url.gtpl & request_body.gtpl
```
Available Variables:
- .correlationId          - Unique request correlation ID
- .integration            - Integration configuration
  - .integration.configuration.{key}  - Custom config values
  - .integration.secrets.{key}        - Secret values
- .customer               - Gladly customer profile
  - .customer.id          - Customer ID in Gladly
  - .customer.emails[]    - Customer email addresses
  - .customer.phones[]    - Customer phone numbers
- .externalData           - Data from dependent data pulls
```

#### response_transformation.gtpl
```
Available Variables:
- .correlationId
- .integration
- .customer
- .rawData                - THE HTTP RESPONSE DATA (JSON object or XML DOM)
- .externalData
- .request                - HTTP request details
- .response               - HTTP response details (status, headers)
```

**CRITICAL**: Use `.rawData` NOT `.response` to access the API response body!

#### external_id.gtpl, external_parent_id.gtpl, external_updated_at.gtpl
```
These templates operate on EACH TRANSFORMED OBJECT individually.

Available Variables:
- .{fieldName}           - Direct access to transformed object fields

Example: If response_transformation.gtpl outputs:
{
  "customerId": "123",
  "orderId": "456"
}

Then external_id.gtpl accesses:
- .customerId (NOT .rawData.customerId!)
- .orderId
```

### Variable Context Cheat Sheet

| Template File | Access API Response | Access Transformed Data |
|--------------|---------------------|------------------------|
| `request_url.gtpl` | N/A | N/A |
| `request_body.gtpl` | N/A | N/A |
| `response_transformation.gtpl` | `.rawData.fieldName` | N/A (you're creating it) |
| `external_id.gtpl` | N/A | `.fieldName` directly |
| `external_parent_id.gtpl` | N/A | `.fieldName` directly |
| `external_updated_at.gtpl` | N/A | `.fieldName` directly |

---

## 4. Data Flow Understanding

### The Pipeline

```
1. request_url.gtpl     - Builds the URL to call
                          Context: .customer, .integration, .externalData

2. HTTP Request         - appcfg makes the request

3. HTTP Response        - Raw JSON/XML response from external API

4. response_transformation.gtpl - Transforms raw response into your schema
                          Context: .rawData contains the HTTP response body
                          Output: JSON matching your GraphQL schema

5. external_id.gtpl     - Extracts unique ID from EACH transformed object
                          Context: Fields of the transformed object directly
                          Output: The ID value (e.g., {{.customerId}})

6. external_parent_id.gtpl - Links child objects to parent (customer profile)
                          Context: Fields of the transformed object directly
                          Output: The parent ID value (e.g., {{.customerId}})

7. UI Template          - Displays data in Gladly
                          Context: Fields from transformed data
```

### Example: Correct Variable Usage

```
API returns:
{
  "data": {
    "customer_id": "cust_123",
    "orders": [...]
  }
}

response_transformation.gtpl:
{
  "customerId": "{{ .rawData.data.customer_id }}"   // Access via .rawData
}

external_id.gtpl:
{{.customerId}}                                     // Access transformed field directly

external_parent_id.gtpl:
{{.customerId}}                                     // Access transformed field directly
```

---

## 5. Common Pitfalls

### Pitfall #1: Wrong Response Transformation Filename
```
WRONG:  response_transform.gtpl
RIGHT:  response_transformation.gtpl
```
**Symptom**: Data pull returns empty or transformation doesn't apply.

### Pitfall #2: Wrong Variable in response_transformation.gtpl
```
WRONG:  {{ .response.fieldName }}
RIGHT:  {{ .rawData.fieldName }}
```
**Symptom**: Template execution error or empty values.

### Pitfall #3: Using .rawData in external_id.gtpl
```
WRONG:  {{.rawData.customerId}}
RIGHT:  {{.customerId}}
```
**Symptom**: External ID extraction fails, data not linked correctly.

### Pitfall #4: Missing external_parent_id.gtpl
```
Without this file, data objects won't be associated with customer profiles!
```
**Symptom**: Data appears in logs but not on customer profile cards.

### Pitfall #5: Card Element Missing Required Attributes
```xml
WRONG:  <Card>
RIGHT:  <Card title="My Card Title">
```
**Symptom**: Build/validation failure or card not rendering.

### Pitfall #6: Forgetting to Create _test_ Folder
```
Without test data, you cannot validate templates before deployment.
```
**Symptom**: `appcfg test data-pull` fails with "no such file or directory".

### Pitfall #7: JSON Syntax Errors in Templates
```
WRONG (trailing comma):
{
  "field1": "value1",
  "field2": "value2",   // <-- trailing comma
}

RIGHT:
{
  "field1": "value1",
  "field2": "value2"
}
```
**Symptom**: JSON parse errors in transformation.

### Pitfall #8: Hardcoded URLs
```
WRONG:  https://api.example.com/data
RIGHT:  {{.integration.configuration.apiBaseUrl}}/data
```
**Symptom**: Works in dev, fails in production.

---

## 6. Validation Steps

### Step-by-Step Validation Process

#### 1. Validate Structure
```bash
appcfg validate -r /path/to/app
appcfg validate data -r /path/to/app
appcfg validate actions -r /path/to/app
```

#### 2. Create Test Data
Create the `_test_` folder with required files:
```
data/pull/{name}/_test_/
  customer.json         # Mock Gladly customer
  integration.json      # Mock integration config
  correlationId.json    # Mock correlation ID
  externalData.json     # Mock dependent data (if any)
  success/
    expected_request_url.txt
    expected_response_transformation.json
```

#### 3. Test Individual Templates
```bash
# Test all targets
appcfg test data-pull {name} -r /path/to/app

# Test specific targets
appcfg test data-pull {name} -t url -r /path/to/app
appcfg test data-pull {name} -t transformation -r /path/to/app
appcfg test data-pull {name} -t externalid -r /path/to/app
appcfg test data-pull {name} -t externalparentid -r /path/to/app
```

#### 4. Build the App
```bash
appcfg build -r /path/to/app
```
This validates AND creates the deployable ZIP file.

---

## 7. Testing Approach

### Local Testing with appcfg

#### Setting Up Run Data
Create `data/pull/_run_/data/` with:
```
integration.json  - Your actual integration config (minus secrets)
customer.json     - A real customer ID to test with
```

#### Run Against Live API
```bash
# Run data pull against external system
appcfg run data-pull -r /path/to/app

# With secrets (don't store in files!)
appcfg run data-pull -r /path/to/app -s '{"apiKey":"xxx"}'

# Output to file for inspection
appcfg run data-pull -r /path/to/app -o file
```

#### Enable Detailed Logging in Gladly
```bash
# Start recording detailed logs for debugging
appcfg apps logs record-detailed start -r /path/to/app

# View logs
appcfg apps logs list -r /path/to/app

# Get detailed log for a specific request
appcfg apps logs detail {logId} -r /path/to/app

# Stop recording when done
appcfg apps logs record-detailed stop -r /path/to/app
```

### Testing Checklist

- [ ] `appcfg validate` passes with no errors
- [ ] `appcfg test data-pull` passes all targets
- [ ] `appcfg run data-pull` returns expected data
- [ ] `appcfg build` creates ZIP without errors
- [ ] App installs without errors
- [ ] Data appears on customer profile in Gladly
- [ ] UI card renders correctly with all fields

---

## 8. Deployment Checklist

### Pre-Deployment

- [ ] All template files use correct filenames
- [ ] `response_transformation.gtpl` uses `.rawData` for API response
- [ ] `external_id.gtpl` uses direct field access (`.fieldName`)
- [ ] `external_parent_id.gtpl` exists and uses direct field access
- [ ] `flexible.card` has `title` attribute on Card element
- [ ] `appcfg validate` passes
- [ ] `appcfg test data-pull` passes
- [ ] `appcfg run data-pull` returns expected data
- [ ] `appcfg build` succeeds

### Deployment Steps

```bash
# 1. Build the app
appcfg build -r /path/to/app

# 2. Install or upgrade
appcfg apps install /path/to/app.zip -r /path/to/app
# OR
appcfg apps upgrade -r /path/to/app

# 3. Configure the app in Gladly
appcfg apps config create -r /path/to/app

# 4. Verify installation
appcfg apps list -r /path/to/app
appcfg apps info {appName} -r /path/to/app
```

### Post-Deployment Verification

- [ ] App appears in Gladly Apps list
- [ ] Configuration is active
- [ ] Test with a real customer profile
- [ ] Verify data appears on customer card
- [ ] Check Gladly App Platform logs for errors

---

## Quick Reference Card

### File Naming
```
response_transformation.gtpl   (NOT response_transform.gtpl)
external_id.gtpl
external_parent_id.gtpl
external_updated_at.gtpl
request_url.gtpl
request_body.gtpl
config.json
flexible.card
```

### Variable Access
```
In response_transformation.gtpl:  .rawData.fieldName
In external_id.gtpl:              .fieldName
In external_parent_id.gtpl:       .fieldName
In request_url.gtpl:              .customer.id, .integration.configuration.xxx
```

### Essential Commands
```bash
appcfg add data-pull {name} -t {type} -v 1.0 -m GET
appcfg add ui-template {name} -t {GraphQLType}
appcfg validate -r /path/to/app
appcfg test data-pull -r /path/to/app
appcfg run data-pull -r /path/to/app
appcfg build -r /path/to/app
appcfg apps logs list -r /path/to/app
```

### Card Template Required Attributes
```xml
<Card title="Required Title">
  <!-- Card content -->
</Card>
```

---

## Troubleshooting Guide

| Symptom | Likely Cause | Solution |
|---------|-------------|----------|
| Data pull returns empty | Wrong filename or `.response` instead of `.rawData` | Check filename is `response_transformation.gtpl`, use `.rawData` |
| External ID not extracted | Using `.rawData.field` in `external_id.gtpl` | Use `.field` directly |
| Data not on customer profile | Missing `external_parent_id.gtpl` | Create file with customer ID field |
| Card not rendering | Missing `title` on Card element | Add `title="..."` attribute |
| Validation fails | JSON syntax error in template | Check for trailing commas, proper escaping |
| Test fails with "no such file" | Missing `_test_` folder | Run `appcfg add data-pull` or create manually |

---

*Document Version: 1.0*
*Created: January 2025*
*Based on issues encountered during conversation-analysis app development*

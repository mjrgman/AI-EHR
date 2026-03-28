# Agentic EHR Deployment Guide

Complete deployment guide for Agentic EHR, covering local development, single-server Docker deployment, and cloud HIPAA BAA deployment options.

## Table of Contents

1. [Local Development](#local-development)
2. [Docker Single-Server Deployment](#docker-single-server-deployment)
3. [Cloud Deployment (AWS/GCP/Azure)](#cloud-deployment)
4. [HIPAA Compliance Checklist](#hipaa-compliance-checklist)
5. [Backup Strategy](#backup-strategy)
6. [Encryption & Key Management](#encryption--key-management)
7. [Network Security](#network-security)
8. [Cost Estimates](#cost-estimates)
9. [Troubleshooting](#troubleshooting)

---

## Local Development

### Prerequisites

- **Node.js**: v22.0.0 or later
- **npm**: v10.0.0 or later
- **SQLite3**: v3.40.0 or later (usually included with Node)

### Setup

```bash
# Clone repository
git clone <repo> agentic-ehr
cd agentic-ehr

# Install dependencies
npm install

# Initialize encryption key (generate once, store securely)
PHI_ENCRYPTION_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
echo "PHI_ENCRYPTION_KEY=$PHI_ENCRYPTION_KEY" > .env.local

# Also generate PHI pepper for searchable hashing
PHI_PEPPER=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
echo "PHI_PEPPER=$PHI_PEPPER" >> .env.local

# Set NODE_ENV
echo "NODE_ENV=development" >> .env.local
echo "PORT=3000" >> .env.local
echo "DATABASE_PATH=./data/agentic-ehr.db" >> .env.local
```

### Running Development Server

```bash
# Terminal 1: Start Node.js backend (with nodemon auto-reload)
npm run server

# Terminal 2: Start Vite frontend dev server
npm run client

# Or run both concurrently:
npm run dev

# Application will be available at http://localhost:5173 (Vite)
# API backend at http://localhost:3000
```

### Database Initialization

```bash
# Run migrations to create schema (including new 5 tables)
node -e "
const sqlite3 = require('sqlite3').verbose();
const migrations = require('./server/database-migrations.js');
const db = new sqlite3.Database('./data/agentic-ehr.db');
migrations.runMigrations(db).then(() => {
  console.log('✓ Migrations complete');
  db.close();
});
"
```

### Testing in Development

```bash
# Run integration tests
npm test

# Check database schema
sqlite3 data/agentic-ehr.db ".schema users"
sqlite3 data/agentic-ehr.db ".schema patient_consent"

# View audit trail
sqlite3 data/agentic-ehr.db "SELECT * FROM agent_audit_trail LIMIT 5;"
```

---

## Docker Single-Server Deployment

**Recommended for**: Small practices (1-5 providers), on-premises HIPAA-compliant server.

### Prerequisites

- **Docker**: v24.0.0 or later
- **Docker Compose**: v2.0.0 or later
- **Server OS**: Ubuntu 22.04 LTS (recommended) or RHEL 8+
- **Resources**: 2 vCPU, 2GB RAM minimum
- **Storage**: 50GB SSD minimum for database + backups

### Setup

#### 1. Prepare Server

```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Docker
sudo apt install -y docker.io docker-compose

# Add user to docker group (non-root access)
sudo usermod -aG docker $USER

# Create application directory
sudo mkdir -p /opt/agentic-ehr
sudo chown $USER:$USER /opt/agentic-ehr
cd /opt/agentic-ehr
```

#### 2. Configuration Files

Create `.env` file:

```env
# Application
NODE_ENV=production
PORT=3000
DATABASE_PATH=/data/agentic-ehr.db
LOG_DIR=/data/logs

# Security - GENERATE NEW VALUES
PHI_ENCRYPTION_KEY=<64-char-hex-from-setup-script>
PHI_PEPPER=<64-char-hex-from-setup-script>
SESSION_SECRET=<32-char-random-string>

# API Keys
CLAUDE_API_KEY=<your-claude-api-key>

# TLS/Certificates
SSL_CERT_PATH=/etc/nginx/certs/server.crt
SSL_KEY_PATH=/etc/nginx/certs/server.key
```

Generate secure values:

```bash
# Generate encryption keys
node -e "console.log('PHI_ENCRYPTION_KEY=' + require('crypto').randomBytes(32).toString('hex'))"
node -e "console.log('PHI_PEPPER=' + require('crypto').randomBytes(32).toString('hex'))"
node -e "console.log('SESSION_SECRET=' + require('crypto').randomBytes(32).toString('hex'))"
```

Create `nginx-default.conf`:

```nginx
# Redirect HTTP to HTTPS
server {
    listen 80;
    server_name _;
    return 301 https://$host$request_uri;
}

# HTTPS server
server {
    listen 443 ssl http2;
    server_name your-domain.com;

    # TLS Configuration
    ssl_certificate /etc/nginx/certs/server.crt;
    ssl_certificate_key /etc/nginx/certs/server.key;
    ssl_protocols TLSv1.3 TLSv1.2;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 10m;

    # Security headers
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "DENY" always;
    add_header X-XSS-Protection "1; mode=block" always;

    # Proxy to agentic-ehr backend
    location / {
        proxy_pass http://agentic-ehr:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

#### 3. Generate TLS Certificates

```bash
# Self-signed (development/testing only)
mkdir -p certs
openssl req -x509 -newkey rsa:4096 -nodes \
  -out certs/server.crt -keyout certs/server.key -days 365 \
  -subj "/CN=your-domain.com"

# Production: Use Let's Encrypt with Certbot
sudo apt install certbot python3-certbot-nginx
sudo certbot certonly --standalone -d your-domain.com
# Copy certs to ./certs/
sudo cp /etc/letsencrypt/live/your-domain.com/fullchain.pem certs/server.crt
sudo cp /etc/letsencrypt/live/your-domain.com/privkey.pem certs/server.key
sudo chown $USER:$USER certs/*
```

#### 4. Deploy with Docker Compose

```bash
# Copy source to deployment directory
cp -r <repo>/server ./
cp -r <repo>/dist ./
cp -r <repo>/package*.json ./
cp Dockerfile docker-compose.yml nginx.conf nginx-default.conf ./

# Build and start services
docker-compose up -d

# Check status
docker-compose ps
docker-compose logs -f agentic-ehr

# Initialize database
docker-compose exec agentic-ehr node -e "
  const migrations = require('./server/database-migrations.js');
  const sqlite3 = require('sqlite3').verbose();
  const db = new sqlite3.Database('/data/agentic-ehr.db');
  migrations.runMigrations(db).then(() => {
    console.log('✓ Migrations complete');
    db.close();
  });
"
```

#### 5. Access Application

```
https://your-domain.com
```

### Monitoring & Logs

```bash
# View application logs
docker-compose logs agentic-ehr

# View nginx logs
docker-compose logs nginx

# Real-time monitoring
docker stats agentic-ehr

# Check database size
docker-compose exec agentic-ehr ls -lh /data/agentic-ehr.db
```

### Backup

```bash
# Create backup directory
sudo mkdir -p /backups/agentic-ehr

# Backup database
docker-compose exec agentic-ehr sqlite3 /data/agentic-ehr.db ".backup /backups/agentic-ehr/$(date +%Y-%m-%d).db"

# Or use WAL snapshot
docker-compose exec agentic-ehr bash -c "
  sqlite3 /data/agentic-ehr.db 'PRAGMA wal_checkpoint(RESTART);'
  cp /data/agentic-ehr.db* /backups/agentic-ehr/$(date +%Y-%m-%d)/
"
```

---

## Cloud Deployment

### AWS Deployment (ECS Fargate + RDS)

**Recommended for**: Medium practices (5-15 providers), multi-site deployments.

#### Architecture

```
Load Balancer (ALB)
    ↓ (HTTPS/TLS 1.3)
ECS Fargate (agentic-ehr container)
    ↓
RDS PostgreSQL (encrypted)
    ↓
S3 (encrypted backups)
    ↓
KMS (encryption key management)
    ↓
CloudWatch (audit logs)
```

#### Setup Steps

##### 1. Create AWS Resources

```bash
# Create VPC and security groups
aws ec2 create-vpc --cidr-block 10.0.0.0/16

# Create RDS PostgreSQL instance
aws rds create-db-instance \
  --db-instance-identifier agentic-ehr-db \
  --db-instance-class db.t4g.micro \
  --engine postgres \
  --master-username admin \
  --master-user-password '<strong-password>' \
  --allocated-storage 100 \
  --storage-encrypted \
  --kms-key-id arn:aws:kms:us-east-1:ACCOUNT:key/KMS-KEY \
  --backup-retention-period 30 \
  --multi-az \
  --publicly-accessible false

# Create S3 bucket for backups
aws s3 mb s3://agentic-ehr-backups-$(date +%s) \
  --region us-east-1

# Enable bucket encryption
aws s3api put-bucket-encryption \
  --bucket agentic-ehr-backups-* \
  --server-side-encryption-configuration '
  {
    "Rules": [{
      "ApplyServerSideEncryptionByDefault": {
        "SSEAlgorithm": "AES256"
      }
    }]
  }'
```

##### 2. Migrate Database from SQLite to PostgreSQL

Use pg_dump and data migration scripts:

```bash
# Install PostgreSQL client
sudo apt install postgresql-client

# Create migration script (see database-migrations.js)
# Adapt SQL to PostgreSQL syntax (AUTOINCREMENT → SERIAL, etc.)

# Backup SQLite
sqlite3 data/agentic-ehr.db ".backup agentic-ehr-backup.db"

# Export data
sqlite3 data/agentic-ehr.db ".mode csv" ".output patients.csv" \
  "SELECT * FROM patients;"
# (repeat for each table)

# Import to RDS PostgreSQL
psql -h rds-endpoint.aws.com -U admin -d agentic_ehr -f schema.sql
psql -h rds-endpoint.aws.com -U admin -d agentic_ehr -c "COPY patients FROM STDIN CSV" < patients.csv
```

##### 3. Create ECS Task Definition

`ecs-task-definition.json`:

```json
{
  "family": "agentic-ehr",
  "networkMode": "awsvpc",
  "requiresCompatibilities": ["FARGATE"],
  "cpu": "512",
  "memory": "1024",
  "containerDefinitions": [
    {
      "name": "agentic-ehr",
      "image": "<YOUR_ECR_REGISTRY>/agentic-ehr:latest",
      "portMappings": [
        {
          "containerPort": 3000,
          "hostPort": 3000,
          "protocol": "tcp"
        }
      ],
      "environment": [
        {
          "name": "NODE_ENV",
          "value": "production"
        },
        {
          "name": "DATABASE_URL",
          "value": "postgresql://user:pass@rds.aws.com:5432/agentic_ehr"
        },
        {
          "name": "PORT",
          "value": "3000"
        }
      ],
      "secrets": [
        {
          "name": "PHI_ENCRYPTION_KEY",
          "valueFrom": "arn:aws:secretsmanager:us-east-1:ACCOUNT:secret:agentic-ehr-phi-key"
        },
        {
          "name": "SESSION_SECRET",
          "valueFrom": "arn:aws:secretsmanager:us-east-1:ACCOUNT:secret:agentic-ehr-session-secret"
        }
      ],
      "logConfiguration": {
        "logDriver": "awslogs",
        "options": {
          "awslogs-group": "/ecs/agentic-ehr",
          "awslogs-region": "us-east-1",
          "awslogs-stream-prefix": "ecs"
        }
      }
    }
  ]
}
```

##### 4. Create ECS Service and ALB

```bash
# Register task definition
aws ecs register-task-definition \
  --cli-input-json file://ecs-task-definition.json

# Create ECS cluster
aws ecs create-cluster --cluster-name agentic-ehr-prod

# Create ALB
aws elbv2 create-load-balancer \
  --name agentic-ehr-alb \
  --subnets subnet-xxx subnet-yyy \
  --security-groups sg-xxx \
  --scheme internet-facing \
  --type application

# Create target group
aws elbv2 create-target-group \
  --name agentic-ehr-targets \
  --protocol HTTP \
  --port 3000 \
  --vpc-id vpc-xxx \
  --health-check-enabled \
  --health-check-protocol HTTP \
  --health-check-path /health

# Create ECS service
aws ecs create-service \
  --cluster agentic-ehr-prod \
  --service-name agentic-ehr \
  --task-definition agentic-ehr \
  --desired-count 2 \
  --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={subnets=[subnet-xxx,subnet-yyy],securityGroups=[sg-xxx],assignPublicIp=DISABLED}" \
  --load-balancers targetGroupArn=arn:aws:elasticloadbalancing:...,containerName=agentic-ehr,containerPort=3000
```

##### 5. Configure Monitoring

```bash
# Create CloudWatch log group
aws logs create-log-group --log-group-name /ecs/agentic-ehr

# Create CloudWatch dashboard
aws cloudwatch put-dashboard \
  --dashboard-name agentic-ehr \
  --dashboard-body file://dashboard.json
```

#### AWS Cost Estimate (Monthly)

| Component | Size | Cost |
|-----------|------|------|
| ECS Fargate | 0.5 vCPU, 1GB | $15 |
| RDS PostgreSQL | db.t4g.micro | $20 |
| S3 (storage) | 100GB backups | $2 |
| Data transfer | 100GB/month | $10 |
| ALB | 1 ALB | $16 |
| CloudWatch Logs | 50GB ingestion | $25 |
| **Total** | | **$88/month** |

### GCP Deployment (Cloud Run + Cloud SQL)

**Recommended for**: Quick deployment, serverless scaling.

#### Architecture

```
Cloud Load Balancer (HTTPS)
    ↓
Cloud Run (agentic-ehr container)
    ↓
Cloud SQL PostgreSQL (encrypted)
    ↓
Cloud Storage (encrypted backups)
    ↓
Secret Manager (key management)
    ↓
Cloud Audit Logs
```

#### Setup Steps

```bash
# Create Cloud SQL PostgreSQL instance
gcloud sql instances create agentic-ehr-db \
  --database-version=POSTGRES_15 \
  --tier=db-f1-micro \
  --region=us-central1 \
  --availability-type=REGIONAL \
  --backup

# Create Cloud SQL database
gcloud sql databases create agentic_ehr \
  --instance=agentic-ehr-db

# Store secrets in Secret Manager
gcloud secrets create agentic-ehr-phi-key \
  --replication-policy="automatic" \
  --data-file=- <<< "$PHI_ENCRYPTION_KEY"

gcloud secrets create agentic-ehr-db-url \
  --replication-policy="automatic" \
  --data-file=- <<< "postgresql://user:pass@sql.googleapis.com/agentic_ehr"

# Build and push image to Cloud Registry
gcloud builds submit \
  --tag gcr.io/PROJECT_ID/agentic-ehr

# Deploy to Cloud Run
gcloud run deploy agentic-ehr \
  --image gcr.io/PROJECT_ID/agentic-ehr \
  --platform managed \
  --region us-central1 \
  --memory 1Gi \
  --cpu 1 \
  --timeout 3600 \
  --no-allow-unauthenticated \
  --add-cloudsql-instances PROJECT_ID:us-central1:agentic-ehr-db \
  --set-env-vars "DATABASE_URL=postgresql://...,NODE_ENV=production" \
  --set-secrets "PHI_ENCRYPTION_KEY=agentic-ehr-phi-key:latest"

# Enable Cloud Armor for security
gcloud compute security-policies create agentic-ehr-policy \
  --description="Agentic EHR security policy"

gcloud compute security-policies rules create 100 \
  --security-policy=agentic-ehr-policy \
  --action=allow
```

#### GCP Cost Estimate (Monthly)

| Component | Size | Cost |
|-----------|------|------|
| Cloud Run | 500K requests, 1GB | $8 |
| Cloud SQL | db-f1-micro | $40 |
| Cloud Storage | 100GB backups | $2 |
| Cloud Audit Logs | 50GB | $25 |
| **Total** | | **$75/month** |

### Azure Deployment (Container Apps + Azure SQL)

**Recommended for**: Microsoft-integrated environments, hybrid clouds.

#### Architecture

```
Application Gateway (HTTPS)
    ↓
Container Apps (agentic-ehr)
    ↓
Azure SQL (encrypted)
    ↓
Blob Storage (encrypted backups)
    ↓
Key Vault (key management)
    ↓
Azure Monitor (audit logs)
```

#### Setup Steps

```bash
# Create Resource Group
az group create --name agentic-ehr-rg --location eastus

# Create Container Registry
az acr create --resource-group agentic-ehr-rg \
  --name aiehr --sku Basic

# Build and push image
az acr build --registry aiehr \
  --image agentic-ehr:latest .

# Create Azure SQL Server
az sql server create \
  --resource-group agentic-ehr-rg \
  --name agentic-ehr-sql \
  --admin-user sqladmin \
  --admin-password '<strong-password>'

# Create database
az sql db create \
  --resource-group agentic-ehr-rg \
  --server agentic-ehr-sql \
  --name agentic_ehr \
  --edition Standard \
  --backup-storage-redundancy Local

# Create Key Vault
az keyvault create \
  --resource-group agentic-ehr-rg \
  --name agentic-ehr-kv \
  --location eastus

# Store secrets
az keyvault secret set \
  --vault-name agentic-ehr-kv \
  --name phi-encryption-key \
  --value "$PHI_ENCRYPTION_KEY"

# Create Container Apps Environment
az containerapp env create \
  --name agentic-ehr-env \
  --resource-group agentic-ehr-rg \
  --location eastus

# Deploy container app
az containerapp create \
  --resource-group agentic-ehr-rg \
  --name agentic-ehr \
  --environment agentic-ehr-env \
  --image aiehr.azurecr.io/agentic-ehr:latest \
  --target-port 3000 \
  --cpu 1 \
  --memory 2Gi \
  --ingress 'external' \
  --env-vars "NODE_ENV=production,PORT=3000" \
  --secrets "phi-key=keyvault:agentic-ehr-kv/phi-encryption-key"
```

#### Azure Cost Estimate (Monthly)

| Component | Size | Cost |
|-----------|------|------|
| Container Apps | 1 vCPU, 2GB | $35 |
| Azure SQL | Standard S0 | $15 |
| Blob Storage | 100GB backups | $2 |
| Azure Monitor | 50GB logs | $25 |
| **Total** | | **$77/month** |

---

## HIPAA Compliance Checklist

### Administrative Safeguards

- [ ] **HIPAA Business Associate Agreements (BAAs)**
  - [ ] Signed with cloud provider (AWS, GCP, Azure)
  - [ ] Covers all subprocessors
  - [ ] Updated within 30 days of processor changes

- [ ] **Security Management Process**
  - [ ] Risk analysis completed (45 CFR §164.308(a)(1)(ii))
  - [ ] Risk management plan implemented
  - [ ] Sanction policy for unauthorized access
  - [ ] Information system security reviews quarterly

- [ ] **Workforce Security**
  - [ ] Authorization/supervision policies in place
  - [ ] Unique user identification (username/password)
  - [ ] Emergency access procedures documented
  - [ ] Termination procedures include credential revocation

- [ ] **Information Access Management**
  - [ ] Role-Based Access Control (RBAC) implemented
  - [ ] Minimum necessary principle applied
  - [ ] Access rights reviewed annually

- [ ] **Security Awareness & Training**
  - [ ] Staff trained on HIPAA security rule
  - [ ] Encryption key management procedures
  - [ ] Password security policies documented
  - [ ] Annual refresher training

### Physical Safeguards

- [ ] **Facility Access Controls**
  - [ ] Secure data center with access logs
  - [ ] No physical access to servers without authorization
  - [ ] Server room locked, monitored

- [ ] **Workstation Security**
  - [ ] Idle timeout (15 minutes)
  - [ ] Screen lock required
  - [ ] No USB drives or removable media
  - [ ] Workstation use policies documented

- [ ] **Device & Media Controls**
  - [ ] Hardware inventory maintained
  - [ ] Encryption enabled on all devices
  - [ ] Disposal procedures document destruction
  - [ ] No unencrypted backups

### Technical Safeguards

- [ ] **Access Controls**
  - [ ] Strong authentication (MFA recommended)
  - [ ] Unique user IDs in database.js users table
  - [ ] Password policy (≥12 chars, complexity)
  - [ ] Account lockout after 5 failed attempts
  - [ ] Session timeout configured

- [ ] **Audit Controls**
  - [ ] Comprehensive audit trail (agent_audit_trail table)
  - [ ] Logs retained for 6+ years
  - [ ] Immutable log storage
  - [ ] Regular log review and testing

- [ ] **Integrity Controls**
  - [ ] Data integrity checks enabled
  - [ ] Database constraints enforced
  - [ ] Checksums/HMAC for sensitive data
  - [ ] Change management procedures

- [ ] **Transmission Security**
  - [ ] TLS 1.3 for all data in transit
  - [ ] Certificate pinning (optional)
  - [ ] VPN for remote access
  - [ ] Encrypted email for PHI transmission

- [ ] **Encryption & Decryption**
  - [ ] AES-256-GCM for PHI at rest (phi-encryption.js)
  - [ ] Encryption keys managed in Key Vault/Secret Manager
  - [ ] No plaintext encryption keys in code/logs
  - [ ] Key rotation every 12 months
  - [ ] Separate encryption keys per environment
  - [ ] IV randomized per record

### Organization Safeguards

- [ ] **Workforce Clearance Procedures**
  - [ ] Background checks for staff with PHI access
  - [ ] Periodic rechecks

- [ ] **Information Access Management**
  - [ ] Database role restrictions enforced
  - [ ] Audit trail for all data access
  - [ ] "View-only" roles where possible

- [ ] **Security Incident Procedures**
  - [ ] Breach response plan documented
  - [ ] 60-day breach notification requirement
  - [ ] Incident log (safety_events table)
  - [ ] Regular security testing/vulnerability scans

---

## Backup Strategy

### SQLite Backup (Single-Server Deployment)

```bash
# 1. WAL-mode snapshots (production recommended)
# WAL (Write-Ahead Logging) enabled in database.js
# Provides point-in-time recovery with reduced I/O

# Create daily backup
0 2 * * * /opt/agentic-ehr/scripts/backup-wal.sh

# backup-wal.sh
#!/bin/bash
BACKUP_DIR="/backups/agentic-ehr"
DATE=$(date +%Y-%m-%d)
DB_PATH="/data/agentic-ehr.db"

# Checkpoint to ensure consistency
sqlite3 $DB_PATH "PRAGMA wal_checkpoint(RESTART);"

# Copy database + WAL files
mkdir -p $BACKUP_DIR/$DATE
cp $DB_PATH* $BACKUP_DIR/$DATE/

# Compress
tar czf $BACKUP_DIR/agentic-ehr-$DATE.tar.gz $BACKUP_DIR/$DATE/

# Remove old backups (keep 30 days)
find $BACKUP_DIR -name "agentic-ehr-*.tar.gz" -mtime +30 -delete
```

### RDS Backup (AWS)

```bash
# Automatic backups (managed by AWS)
# Retention: 30 days (configured in RDS)
# Point-in-time recovery: supported

# Manual snapshot
aws rds create-db-snapshot \
  --db-instance-identifier agentic-ehr-db \
  --db-snapshot-identifier agentic-ehr-snapshot-$(date +%Y-%m-%d)

# Export to S3
aws rds start-export-task \
  --export-task-identifier agentic-ehr-export-$(date +%Y-%m-%d) \
  --source-arn arn:aws:rds:us-east-1:ACCOUNT:db:agentic-ehr-db \
  --s3-bucket-name agentic-ehr-backups \
  --iam-role-arn arn:aws:iam::ACCOUNT:role/ExportRole
```

### S3 Replication

```bash
# Enable cross-region replication
aws s3api put-bucket-replication \
  --bucket agentic-ehr-backups \
  --replication-configuration '{
    "Role": "arn:aws:iam::ACCOUNT:role/s3-replication",
    "Rules": [{
      "Status": "Enabled",
      "Priority": 1,
      "DeleteMarkerReplication": {"Status": "Enabled"},
      "Filter": {"Prefix": ""},
      "Destination": {
        "Bucket": "arn:aws:s3:::agentic-ehr-backups-replica",
        "ReplicationTime": {"Status": "Enabled", "Time": {"Minutes": 15}},
        "Metrics": {"Status": "Enabled", "EventThreshold": {"Minutes": 15}}
      }
    }]
  }'
```

### Restore Procedure

```bash
# SQLite restore from backup
sqlite3 agentic-ehr-backup.db ".restore /backups/agentic-ehr/2024-03-22/agentic-ehr.db"

# RDS restore from snapshot
aws rds restore-db-instance-from-db-snapshot \
  --db-instance-identifier agentic-ehr-restored \
  --db-snapshot-identifier agentic-ehr-snapshot-2024-03-22 \
  --db-instance-class db.t4g.micro

# Test restore before deleting backup
# - Verify all tables present
# - Check patient data integrity
# - Confirm encryption keys work
# - Validate audit logs
```

---

## Encryption & Key Management

### At-Rest Encryption

**PHI Encryption Module** (`server/security/phi-encryption.js`)

```javascript
// Encrypt patient record
const patientData = {
  first_name: "John",
  last_name: "Doe",
  ssn: "123-45-6789",
  email: "john@example.com"
};

const encrypted = phiEncryption.encryptFields(patientData);
// Result: each PHI field is AES-256-GCM encrypted

// Store in database
await db.run(
  "INSERT INTO patients (mrn, first_name, last_name, ssn, email) VALUES (?, ?, ?, ?, ?)",
  [mrn, encrypted.first_name, encrypted.last_name, encrypted.ssn, encrypted.email]
);

// Retrieve and decrypt
const storedData = await db.get("SELECT * FROM patients WHERE mrn = ?", [mrn]);
const decrypted = phiEncryption.decryptFields(storedData);
// Result: plaintext PHI available only in memory for processing
```

**Encryption Key Management**

```bash
# 1. Generate master encryption key (one-time)
PHI_ENCRYPTION_KEY=$(openssl rand -hex 32)

# 2. Store in secure vault
# AWS: Secrets Manager
aws secretsmanager create-secret \
  --name agentic-ehr/phi-encryption-key \
  --secret-string "$PHI_ENCRYPTION_KEY" \
  --kms-key-id arn:aws:kms:us-east-1:ACCOUNT:key/KMS-KEY

# GCP: Secret Manager
gcloud secrets create agentic-ehr-phi-key \
  --data-file=- <<< "$PHI_ENCRYPTION_KEY"

# Azure: Key Vault
az keyvault secret set \
  --vault-name agentic-ehr-kv \
  --name phi-encryption-key \
  --value "$PHI_ENCRYPTION_KEY"

# 3. Retrieve at runtime (never in .env or code)
# Application loads from Secret Manager at startup
const keyMaterial = await secretsManager.getSecret('agentic-ehr/phi-encryption-key');
process.env.PHI_ENCRYPTION_KEY = keyMaterial;

# 4. Key rotation (every 12 months)
# - Generate new key
# - Use reencryptWithNewKey() for all encrypted records
# - Test on staging first
# - Deploy to production during maintenance window
# - Archive old key (retain for 6 years per HIPAA)
```

### In-Transit Encryption

**TLS 1.3 Configuration**

```nginx
# nginx.conf
ssl_protocols TLSv1.3 TLSv1.2;
ssl_ciphers HIGH:!aNULL:!MD5;
ssl_prefer_server_ciphers on;

# HSTS (Strict-Transport-Security)
add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;

# Certificate pinning (optional, advanced)
add_header Public-Key-Pins "pin-sha256=\"...\"; max-age=2592000; includeSubDomains" always;
```

**VPN for Remote Access**

```bash
# For remote providers (telehealth scenarios)
# OpenVPN or WireGuard required for access to production

# Example: WireGuard setup
apt install wireguard wireguard-tools

# Generate keys
wg genkey | tee private.key | wg pubkey > public.key

# Configure /etc/wireguard/wg0.conf
[Interface]
PrivateKey = <server-private-key>
Address = 10.0.0.1/24
ListenPort = 51820

[Peer]
PublicKey = <client-public-key>
AllowedIPs = 10.0.0.2/32
```

---

## Network Security

### VPC & Security Groups (AWS)

```bash
# Create VPC
aws ec2 create-vpc --cidr-block 10.0.0.0/16

# Create subnets
aws ec2 create-subnet \
  --vpc-id vpc-xxx \
  --cidr-block 10.0.1.0/24 \
  --availability-zone us-east-1a

# Create security group
aws ec2 create-security-group \
  --group-name agentic-ehr-sg \
  --description "Agentic EHR security group" \
  --vpc-id vpc-xxx

# Allow HTTPS from specific IP ranges (providers only)
aws ec2 authorize-security-group-ingress \
  --group-id sg-xxx \
  --protocol tcp \
  --port 443 \
  --cidr 203.0.113.0/24  # Provider's office IP range

# Allow SSH from bastion host only
aws ec2 authorize-security-group-ingress \
  --group-id sg-xxx \
  --protocol tcp \
  --port 22 \
  --source-security-group-id sg-bastion

# Deny all other inbound
# (default security group behavior)

# RDS: isolated subnet group (no public access)
aws rds create-db-subnet-group \
  --db-subnet-group-name agentic-ehr-subnets \
  --db-subnet-group-description "Agentic EHR RDS subnets" \
  --subnet-ids subnet-1a subnet-1b
```

### Firewall Rules

```
Inbound:
  - HTTPS (443): Restricted to provider IP ranges
  - SSH (22): Bastion host only
  - All other: DENY

Outbound:
  - HTTPS (443): Any (API calls, external services)
  - DNS (53): Required (domain resolution)
  - NTP (123): Required (time synchronization)
  - All other: DENY
```

### No Public Database Access

```bash
# CRITICAL: Database must NOT be accessible from internet

# AWS RDS: place in private subnet
aws rds create-db-instance \
  --db-instance-identifier agentic-ehr-db \
  --db-subnet-group-name agentic-ehr-subnets \
  --publicly-accessible false

# Verify
aws rds describe-db-instances \
  --query 'DBInstances[0].PubliclyAccessible'
# Output: false

# Access via VPC only (through application in public subnet)
# Or through secure VPN tunnel from provider's office
```

---

## Cost Estimates

### Small Practice (1-5 providers)

**Docker Single-Server Deployment**

| Item | Cost |
|------|------|
| Bare metal or VPS (2 vCPU, 2GB RAM) | $50-100/month |
| Static IP address | $5/month |
| Domain name | $12/year |
| SSL certificate (Let's Encrypt) | FREE |
| Backup storage (local or S3) | $5/month |
| **Total** | **$60-110/month** |

**AWS Option**

| Item | Cost |
|------|------|
| ECS Fargate (0.5 vCPU, 1GB) | $15 |
| RDS db.t4g.micro | $20 |
| S3 backup storage (50GB) | $1 |
| ALB | $16 |
| CloudWatch | $10 |
| Data transfer | $5 |
| **Total** | **$67/month** |

### Medium Practice (5-15 providers)

**AWS Deployment**

| Item | Cost |
|------|------|
| ECS Fargate (1 vCPU, 2GB, 2 tasks) | $60 |
| RDS db.t4g.small | $50 |
| S3 backup storage (200GB) | $5 |
| ALB | $16 |
| CloudWatch | $25 |
| Data transfer | $20 |
| **Total** | **$176/month** |

### Large Practice / Multi-Site (15+ providers)

**AWS Deployment (High Availability)**

| Item | Cost |
|------|------|
| ECS Fargate (2 vCPU, 4GB, 4 tasks across AZs) | $400 |
| RDS db.r6i.large (Multi-AZ) | $400 |
| S3 backup storage (500GB) | $12 |
| ALB | $16 |
| CloudWatch | $50 |
| Data transfer (1TB/month) | $150 |
| VPN for remote sites | $50 |
| **Total** | **$1,078/month** |

---

## Troubleshooting

### Database Connection Issues

```bash
# Check database file exists
ls -lh /data/agentic-ehr.db

# Verify SQLite integrity
sqlite3 /data/agentic-ehr.db "PRAGMA integrity_check;"
# Output: ok

# Check WAL files
ls -la /data/agentic-ehr.db-*

# Recover corrupted database
sqlite3 /data/agentic-ehr.db ".recover" | sqlite3 /data/agentic-ehr-recovered.db
```

### Encryption Key Issues

```bash
# Verify key is set
echo $PHI_ENCRYPTION_KEY | wc -c  # Should be 65 (64 hex + newline)

# Test encryption/decryption
node -e "
  process.env.PHI_ENCRYPTION_KEY = process.env.PHI_ENCRYPTION_KEY;
  const phi = require('./server/security/phi-encryption.js');
  const encrypted = phi.encrypt('test');
  const decrypted = phi.decrypt(encrypted);
  console.log('Encrypted:', encrypted.substring(0, 50) + '...');
  console.log('Decrypted:', decrypted);
"

# If key is missing/wrong:
# 1. Retrieve from Secret Manager
# 2. Set environment variable
# 3. Restart application
```

### Performance Issues

```bash
# Check database size
du -sh /data/agentic-ehr.db

# Analyze query performance
sqlite3 /data/agentic-ehr.db "EXPLAIN QUERY PLAN SELECT * FROM patients WHERE id = ?;"

# Rebuild indexes if slow
sqlite3 /data/agentic-ehr.db "REINDEX;"

# Check application logs
docker-compose logs --tail=100 agentic-ehr

# Monitor resource usage
docker stats agentic-ehr

# If memory leak suspected:
# - Enable heap snapshot
# - Check for circular references
# - Restart container
```

### TLS/HTTPS Issues

```bash
# Check certificate validity
openssl x509 -in certs/server.crt -text -noout

# Verify certificate matches key
openssl x509 -noout -modulus -in certs/server.crt | openssl md5
openssl rsa -noout -modulus -in certs/server.key | openssl md5
# Both MD5 sums should match

# Test TLS connection
openssl s_client -connect localhost:443

# Check nginx logs
docker-compose logs nginx | grep -i ssl
```

### Audit Trail Issues

```bash
# Verify agent_audit_trail table exists
sqlite3 /data/agentic-ehr.db ".schema agent_audit_trail"

# Check audit entries
sqlite3 /data/agentic-ehr.db "SELECT COUNT(*) FROM agent_audit_trail;"

# Export audit trail for compliance review
sqlite3 /data/agentic-ehr.db ".mode csv" ".output audit-trail-2024.csv" \
  "SELECT * FROM agent_audit_trail ORDER BY timestamp DESC;"
```

---

## Additional Resources

- [HIPAA Security Rule (45 CFR §164.300-318)](https://www.govinfo.gov/content/pkg/CFR-2021-title45-vol1/pdf/CFR-2021-title45-vol1-sec164-300.pdf)
- [AWS HIPAA Compliance](https://aws.amazon.com/compliance/hipaa/)
- [GCP HIPAA Compliance](https://cloud.google.com/security/compliance/hipaa)
- [Azure HIPAA Compliance](https://learn.microsoft.com/en-us/azure/compliance/offerings/offering-hipaa-us)
- [OWASP Top 10 for Healthcare](https://owasp.org/)
- [SQLite WAL Mode](https://www.sqlite.org/wal.html)
- [TLS 1.3 Recommendations](https://www.rfc-editor.org/rfc/rfc8446.html)

---

**Last Updated**: 2024-03-22
**Version**: 1.0
**Author**: ImpactMed Consulting

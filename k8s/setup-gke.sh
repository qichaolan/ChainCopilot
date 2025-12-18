#!/bin/bash
# GKE Setup Script for ChainCopilot with Google Secret Manager
# Usage: ./setup-gke.sh <PROJECT_ID> <GOOGLE_API_KEY>

set -e

PROJECT_ID=${1:-"your-project-id"}
GOOGLE_API_KEY=${2:-"your-google-api-key"}
CLUSTER_NAME="chaincopilot-cluster"
REGION="us-central1"
K8S_NAMESPACE="default"
K8S_SA="chaincopilot-sa"
GCP_SA="chaincopilot-sa"

echo "=== ChainCopilot GKE Setup ==="
echo "Project: $PROJECT_ID"
echo "Cluster: $CLUSTER_NAME"
echo "Region: $REGION"
echo ""

# Check if required arguments are provided
if [ "$PROJECT_ID" == "your-project-id" ] || [ "$GOOGLE_API_KEY" == "your-google-api-key" ]; then
    echo "Usage: ./setup-gke.sh <PROJECT_ID> <GOOGLE_API_KEY>"
    echo "Example: ./setup-gke.sh my-gcp-project AIzaSy..."
    exit 1
fi

# Set the project
echo "1. Setting GCP project..."
gcloud config set project $PROJECT_ID

# Enable required APIs
echo "2. Enabling required APIs..."
gcloud services enable \
    container.googleapis.com \
    secretmanager.googleapis.com \
    containerregistry.googleapis.com \
    cloudbuild.googleapis.com

# Create GKE cluster with Workload Identity enabled
echo "3. Creating GKE cluster (this may take several minutes)..."
gcloud container clusters create $CLUSTER_NAME \
    --region $REGION \
    --workload-pool=$PROJECT_ID.svc.id.goog \
    --enable-secret-manager \
    --num-nodes=1 \
    --machine-type=e2-medium \
    || echo "Cluster may already exist, continuing..."

# Get cluster credentials
echo "4. Getting cluster credentials..."
gcloud container clusters get-credentials $CLUSTER_NAME --region $REGION

# Create the secret in Google Secret Manager
echo "5. Creating secret in Google Secret Manager..."
echo -n "$GOOGLE_API_KEY" | gcloud secrets create google-api-key \
    --replication-policy="automatic" \
    --data-file=- \
    || echo "Secret may already exist, updating..."

# Update secret if it already exists
echo -n "$GOOGLE_API_KEY" | gcloud secrets versions add google-api-key --data-file=- \
    || true

# Create GCP service account for Workload Identity
echo "6. Creating GCP service account..."
gcloud iam service-accounts create $GCP_SA \
    --display-name="ChainCopilot Service Account" \
    || echo "Service account may already exist, continuing..."

# Grant Secret Manager access to the service account
echo "7. Granting Secret Manager access..."
gcloud secrets add-iam-policy-binding google-api-key \
    --member="serviceAccount:$GCP_SA@$PROJECT_ID.iam.gserviceaccount.com" \
    --role="roles/secretmanager.secretAccessor"

# Create Workload Identity binding
echo "8. Creating Workload Identity binding..."
gcloud iam service-accounts add-iam-policy-binding $GCP_SA@$PROJECT_ID.iam.gserviceaccount.com \
    --role="roles/iam.workloadIdentityUser" \
    --member="serviceAccount:$PROJECT_ID.svc.id.goog[$K8S_NAMESPACE/$K8S_SA]"

# Replace PROJECT_ID in Kubernetes manifests
echo "9. Updating Kubernetes manifests with PROJECT_ID..."
sed -i.bak "s/PROJECT_ID/$PROJECT_ID/g" k8s/deployment.yaml
sed -i.bak "s/PROJECT_ID/$PROJECT_ID/g" k8s/service-account.yaml
sed -i.bak "s/PROJECT_ID/$PROJECT_ID/g" k8s/secret-provider.yaml

# Apply Kubernetes resources
echo "10. Applying Kubernetes resources..."
kubectl apply -f k8s/service-account.yaml
kubectl apply -f k8s/secret-provider.yaml
kubectl apply -f k8s/deployment.yaml

echo ""
echo "=== Setup Complete ==="
echo "To check deployment status:"
echo "  kubectl get pods -l app=chaincopilot"
echo "  kubectl get svc chaincopilot-service"
echo ""
echo "To get external IP:"
echo "  kubectl get svc chaincopilot-service -o jsonpath='{.status.loadBalancer.ingress[0].ip}'"
echo ""
echo "To view logs:"
echo "  kubectl logs -l app=chaincopilot -f"

#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import * as dotenv from 'dotenv';
import 'source-map-support/register';
import { PipelineStack } from '../lib/pipeline';

dotenv.config();

const {
  CDK_DEFAULT_ACCOUNT: account = '',
  CDK_DEFAULT_REGION: region = '',
  CODESTAR_CONNECTION_ARN: codestarConnectionArn = '',
  ENV: environmentName = '',
  GITHUB_OWNER: githubOwner = '',
  GITHUB_REPO: githubRepo = '',
} = process.env;

const branchName = environmentName === 'dev' ? 'main' : environmentName;

// Check for required env vars for deployment
if (
  ![
    account,
    branchName,
    codestarConnectionArn,
    environmentName,
    githubOwner,
    githubRepo,
    region,
  ].every((envVal) => !!envVal)
) {
  console.log(
    JSON.stringify(
      {
        account,
        branchName,
        codestarConnectionArn,
        environmentName,
        githubOwner,
        githubRepo,
        region,
      },
      null,
      2,
    ),
  );
  throw new Error('Missing environment variables');
}

const env = { account, region };

const app = new cdk.App();

new PipelineStack(app, 'AppsyncEsStack', {
  branchName,
  codestarConnectionArn,
  env,
  environmentName,
  githubOwner,
  githubRepo,
});

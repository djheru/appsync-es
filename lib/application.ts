import { Stage, StageProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { AccountStack } from './accounts';
import { ApiStack } from './api';

export class Application extends Stage {
  constructor(scope: Construct, id: string, props?: StageProps) {
    super(scope, id, props);

    const apiStack = new ApiStack(this, 'API');

    new AccountStack(this, 'Accounts', {
      appsyncApi: apiStack.api,
    });
  }
}

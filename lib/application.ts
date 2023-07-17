import { Stage, StageProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { AccountStack } from './accounts/account';

export class Application extends Stage {
  constructor(scope: Construct, id: string, props?: StageProps) {
    super(scope, id, props);

    new AccountStack(this, 'Accounts');
  }
}

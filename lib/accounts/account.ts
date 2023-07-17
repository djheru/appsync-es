import { CfnOutput, RemovalPolicy, Stack, StackProps } from 'aws-cdk-lib';
import { GraphqlApi } from 'aws-cdk-lib/aws-appsync';
import {
  AttributeType,
  BillingMode,
  StreamViewType,
  Table,
} from 'aws-cdk-lib/aws-dynamodb';
import { EventBus, Rule } from 'aws-cdk-lib/aws-events';
import { LambdaFunction } from 'aws-cdk-lib/aws-events-targets';
import { StartingPosition } from 'aws-cdk-lib/aws-lambda';
import { DynamoEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Construct } from 'constructs';
import { camelCase, lowerCase } from 'lodash';
import { EventType } from './models/account';
// import * as sqs from 'aws-cdk-lib/aws-sqs';

export interface AccountStackProps extends StackProps {
  appsyncApi: GraphqlApi;
}
export class AccountStack extends Stack {
  public eventBus: EventBus;

  constructor(
    scope: Construct,
    id: string,
    private readonly props: AccountStackProps,
  ) {
    super(scope, id, props);

    const lambdaResolver = new NodejsFunction(this, 'resolver', {
      functionName: 'AccountResolver',
    });

    const datasource = this.props.appsyncApi.addLambdaDataSource(
      'lambdaResolver',
      lambdaResolver,
    );

    const fields = [
      { typeName: 'Query', fieldName: 'getAccount' },
      { typeName: 'Mutation', fieldName: 'createAccount' },
      { typeName: 'Mutation', fieldName: 'creditAccount' },
      { typeName: 'Mutation', fieldName: 'debitAccount' },
    ];

    fields.forEach(({ typeName, fieldName }) =>
      datasource.createResolver(`${typeName}${fieldName}Resolver`, {
        typeName,
        fieldName,
      }),
    );

    const streamHandler = new NodejsFunction(this, 'stream', {
      functionName: 'StreamHandler',
    });

    const table = new Table(this, 'Table', {
      tableName: 'Accounts',
      partitionKey: { name: 'id', type: AttributeType.STRING },
      sortKey: { name: 'version', type: AttributeType.NUMBER },
      billingMode: BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY,
      timeToLiveAttribute: 'expires',
      stream: StreamViewType.NEW_IMAGE,
    });
    table.grantReadWriteData(lambdaResolver);
    lambdaResolver.addEnvironment('TABLE_NAME', table.tableName);
    streamHandler.addEnvironment('TABLE_NAME', table.tableName);

    this.eventBus = new EventBus(this, 'AccountEvents', {
      eventBusName: 'AccountEvents',
    });
    this.eventBus.grantPutEventsTo(streamHandler);
    streamHandler.addEnvironment('EVENT_BUS_NAME', this.eventBus.eventBusName);

    streamHandler.addEventSource(
      new DynamoEventSource(table, {
        startingPosition: StartingPosition.LATEST,
        batchSize: 10,
      }),
    );

    this.buildConsumer('AccountCreated', EventType.CREATED);
    this.buildConsumer('AccountCredited', EventType.CREDITED);
    this.buildConsumer('AccountDebited', EventType.DEBITED);

    new CfnOutput(this, 'lambda', { value: lambdaResolver.functionArn });
  }

  buildConsumer(functionName: string, eventType: EventType) {
    const consumer = new NodejsFunction(this, lowerCase(eventType), {
      functionName: `${functionName}Consumer`,
    });

    const accountEventRule = new Rule(this, `${camelCase(eventType)}Rule`, {
      description: `Listen to Account ${eventType} events`,
      eventPattern: {
        source: ['myapp.accounts'],
        detailType: [eventType],
      },
      eventBus: this.eventBus,
    });
    accountEventRule.addTarget(new LambdaFunction(consumer));
  }
}

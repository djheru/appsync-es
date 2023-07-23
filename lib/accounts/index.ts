import { CfnOutput, RemovalPolicy, Stack, StackProps } from 'aws-cdk-lib';
import { GraphqlApi, LambdaDataSource } from 'aws-cdk-lib/aws-appsync';
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
import { camelCase, kebabCase, lowerCase } from 'lodash';
import { EventType } from './models/account';
// import * as sqs from 'aws-cdk-lib/aws-sqs';

export interface AccountStackProps extends StackProps {
  appsyncApi: GraphqlApi;
}
export class AccountStack extends Stack {
  public eventBus: EventBus;
  public lambdaResolver: NodejsFunction;
  public datasource: LambdaDataSource;
  public streamHandler: NodejsFunction;
  public table: Table;

  constructor(
    scope: Construct,
    id: string,
    private readonly props: AccountStackProps,
  ) {
    super(scope, id, props);

    this.buildResources();
  }

  buildResources() {
    this.buildLambdaResolver('AccountResolver');
    this.buildLambdaDataSource('LambdaResolver');
    this.buildStreamHandler('StreamHandler');
    this.buildTable('Accounts');
    this.buildEventBus('AccountEvents');
    this.buildConsumer('AccountCreated', EventType.CREATED);
    this.buildConsumer('AccountCredited', EventType.CREDITED);
    this.buildConsumer('AccountDebited', EventType.DEBITED);
  }

  buildEventBus(eventBusName: string) {
    this.eventBus = new EventBus(this, eventBusName, {
      eventBusName,
    });
  }

  buildLambdaResolver(functionName: string) {
    this.lambdaResolver = new NodejsFunction(this, lowerCase(functionName), {
      functionName,
      entry: 'resolver.ts',
    });
    new CfnOutput(this, lowerCase(functionName), {
      value: this.lambdaResolver.functionArn,
    });
  }

  buildLambdaDataSource(datasourceName: string) {
    this.datasource = this.props.appsyncApi.addLambdaDataSource(
      datasourceName,
      this.lambdaResolver,
    );

    const fields = [
      { typeName: 'Query', fieldName: 'getAccount' },
      { typeName: 'Mutation', fieldName: 'createAccount' },
      { typeName: 'Mutation', fieldName: 'creditAccount' },
      { typeName: 'Mutation', fieldName: 'debitAccount' },
    ];

    fields.forEach(({ typeName, fieldName }) =>
      this.datasource.createResolver(`${typeName}${fieldName}Resolver`, {
        typeName,
        fieldName,
      }),
    );
  }

  buildTable(tableName: string) {
    this.table = new Table(this, `${camelCase(tableName)}Table`, {
      tableName,
      partitionKey: { name: 'id', type: AttributeType.STRING },
      sortKey: { name: 'version', type: AttributeType.NUMBER },
      billingMode: BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY,
      timeToLiveAttribute: 'expires',
      stream: StreamViewType.NEW_IMAGE,
    });
    this.table.grantReadWriteData(this.lambdaResolver);
    this.lambdaResolver.addEnvironment('TABLE_NAME', this.table.tableName);
    this.streamHandler.addEnvironment('TABLE_NAME', this.table.tableName);
  }

  buildStreamHandler(functionName: string) {
    this.streamHandler = new NodejsFunction(this, lowerCase(functionName), {
      functionName,
      entry: './stream.ts',
    });
    this.eventBus.grantPutEventsTo(this.streamHandler);
    this.streamHandler.addEnvironment(
      'EVENT_BUS_NAME',
      this.eventBus.eventBusName,
    );

    this.streamHandler.addEventSource(
      new DynamoEventSource(this.table, {
        startingPosition: StartingPosition.LATEST,
        batchSize: 10,
      }),
    );
    new CfnOutput(this, lowerCase(functionName), {
      value: this.streamHandler.functionArn,
    });
  }

  buildConsumer(functionName: string, eventType: EventType) {
    const consumer = new NodejsFunction(this, lowerCase(eventType), {
      functionName: `${functionName}Consumer`,
      entry: `events/${kebabCase(eventType)}.ts`,
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
    new CfnOutput(this, `${lowerCase(eventType)}-consumer`, {
      value: consumer.functionArn,
    });
  }
}

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
import { camelCase, kebabCase, lowerCase, upperCase } from 'lodash';
import { join } from 'path';
import { EventType } from './models/account';

/**
 * Properties for AccountStack
 * @property {GraphqlApi} appsyncApi - The AppSync API.
 */
export interface AccountStackProps extends StackProps {
  appsyncApi: GraphqlApi;
}

/**
 * A Stack for handling Accounts
 */
export class AccountStack extends Stack {
  public eventBus: EventBus; // Event bus for handling events
  public lambdaResolver: NodejsFunction; // Lambda function for GraphQL resolver
  public datasource: LambdaDataSource; // Data source for AppSync API
  public streamHandler: NodejsFunction; // Lambda function for handling DynamoDB stream events
  public table: Table; // DynamoDB table for Accounts

  // Array for storing the query fields for GraphQL resolver
  public queryFields: { typeName: string; fieldName: string }[] = [
    { typeName: 'Query', fieldName: 'getAccount' },
    { typeName: 'Query', fieldName: 'getAccountList' },
    { typeName: 'Mutation', fieldName: 'createAccount' },
    { typeName: 'Mutation', fieldName: 'creditAccount' },
    { typeName: 'Mutation', fieldName: 'debitAccount' },
  ];

  /**
   * Constructor for AccountStack
   * @param {Construct} scope - The parent construct, or 'this' if a top level construct
   * @param {string} id - The name of the construct
   * @param {AccountStackProps} props - The properties for the construct
   */
  constructor(
    scope: Construct,
    id: string,
    private readonly props: AccountStackProps,
  ) {
    super(scope, id, props);

    // Build resources
    this.buildResources();
  }

  /**
   * Build all resources for the stack
   */
  buildResources() {
    this.buildEventBus('AccountEvents'); // Build event bus
    this.buildLambdaResolver('AccountResolver'); // Build Lambda resolver
    this.buildLambdaDataSource('LambdaResolver'); // Build Lambda data source
    this.buildTable('Accounts'); // Build DynamoDB table
    this.buildStreamHandler('StreamHandler'); // Build stream handler
    // Build consumers for different event types
    this.buildConsumer('AccountCreated', EventType.CREATED);
    this.buildConsumer('AccountCredited', EventType.CREDITED);
    this.buildConsumer('AccountDebited', EventType.DEBITED);
  }

  /**
   * Build an Event Bus
   * @param {string} eventBusName - The name of the event bus
   */
  buildEventBus(eventBusName: string) {
    this.eventBus = new EventBus(this, eventBusName, {
      eventBusName,
    });
  }

  /**
   * Build a Lambda function for GraphQL resolver
   * @param {string} functionName - The name of the function
   */
  buildLambdaResolver(functionName: string) {
    this.lambdaResolver = new NodejsFunction(this, lowerCase(functionName), {
      functionName,
      entry: join(__dirname, 'resolver.ts'),
    });
    new CfnOutput(this, upperCase(functionName), {
      value: this.lambdaResolver.functionArn,
    });
  }

  /**
   * Build a Lambda data source for AppSync API
   * @param {string} datasourceName - The name of the data source
   */
  buildLambdaDataSource(datasourceName: string) {
    this.datasource = this.props.appsyncApi.addLambdaDataSource(
      datasourceName,
      this.lambdaResolver,
    );

    // Create resolvers for each query field
    this.queryFields.forEach(({ typeName, fieldName }) =>
      this.datasource.createResolver(`${typeName}${fieldName}Resolver`, {
        typeName,
        fieldName,
      }),
    );
  }

  /**
   * Build a DynamoDB table for Accounts
   * @param {string} tableName - The name of the table
   */
  buildTable(tableName: string) {
    this.table = new Table(this, `${camelCase(tableName)}Table`, {
      tableName,
      partitionKey: { name: 'pk', type: AttributeType.STRING },
      sortKey: { name: 'sk', type: AttributeType.NUMBER },
      billingMode: BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY,
      timeToLiveAttribute: 'expires',
      stream: StreamViewType.NEW_IMAGE,
    });

    // Add a Global Secondary Index to the table
    this.table.addGlobalSecondaryIndex({
      indexName: `${tableName}GSI`,
      partitionKey: { name: 'gsi_pk', type: AttributeType.STRING },
      sortKey: { name: 'gsi_sk', type: AttributeType.STRING },
    });

    // Grant read/write permissions to the Lambda resolver
    this.table.grantReadWriteData(this.lambdaResolver);

    // Add the table name to the Lambda resolver's environment variables
    this.lambdaResolver.addEnvironment('TABLE_NAME', this.table.tableName);
  }

  /**
   * Build a Lambda function for handling DynamoDB stream events
   * @param {string} functionName - The name of the function
   */
  buildStreamHandler(functionName: string) {
    this.streamHandler = new NodejsFunction(this, lowerCase(functionName), {
      functionName,
      entry: join(__dirname, 'stream.ts'),
    });

    // Grant the stream handler permissions to put events to the event bus
    this.eventBus.grantPutEventsTo(this.streamHandler);

    // Add the event bus name to the stream handler's environment variables
    this.streamHandler.addEnvironment(
      'EVENT_BUS_NAME',
      this.eventBus.eventBusName,
    );

    // Add a DynamoDB stream event source to the stream handler
    this.streamHandler.addEventSource(
      new DynamoEventSource(this.table, {
        startingPosition: StartingPosition.LATEST,
        batchSize: 10,
      }),
    );

    // Add the table name to the stream handler's environment variables
    this.streamHandler.addEnvironment('TABLE_NAME', this.table.tableName);

    new CfnOutput(this, upperCase(functionName), {
      value: this.streamHandler.functionArn,
    });
  }

  /**
   * Build a consumer for a specific event type
   * @param {string} functionName - The base name of the function
   * @param {EventType} eventType - The event type
   */
  buildConsumer(functionName: string, eventType: EventType) {
    const consumer = new NodejsFunction(this, lowerCase(eventType), {
      functionName: `${functionName}Consumer`,
      entry: join(__dirname, 'events', `${kebabCase(eventType)}.ts`),
    });

    const accountEventRule = new Rule(this, `${camelCase(eventType)}Rule`, {
      description: `Listen to Account ${eventType} events`,
      eventPattern: {
        source: ['myapp.accounts'],
        detailType: [eventType],
      },
      eventBus: this.eventBus,
    });

    // Add the consumer as a target of the event rule
    accountEventRule.addTarget(new LambdaFunction(consumer));

    new CfnOutput(this, `${upperCase(`${eventType}Consumer`)}`, {
      value: consumer.functionArn,
    });
  }
}

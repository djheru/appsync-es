import * as cdk from 'aws-cdk-lib';
import {
  AuthorizationType,
  FieldLogLevel,
  GraphqlApi,
  SchemaFile,
} from 'aws-cdk-lib/aws-appsync';
import {
  Certificate,
  CertificateValidation,
} from 'aws-cdk-lib/aws-certificatemanager';
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
import { CnameRecord, HostedZone } from 'aws-cdk-lib/aws-route53';
import { Construct } from 'constructs';
import { camelCase, lowerCase } from 'lodash';
import { join } from 'path';
import { EventType } from './models/account';
// import * as sqs from 'aws-cdk-lib/aws-sqs';

export class AccountStack extends cdk.Stack {
  public eventBus: EventBus;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const domainName = 'api.dev.prosaist.io';

    const zone = HostedZone.fromLookup(this, 'hostedzone', {
      domainName: domainName.split('.').slice(1).join('.'),
      privateZone: false,
    });

    const certificate = new Certificate(this, 'cert', {
      domainName,
      certificateName: 'graphqlApiCertificate',
      validation: CertificateValidation.fromDns(zone),
    });

    const api = new GraphqlApi(this, 'api', {
      name: 'AccountsApi',
      schema: SchemaFile.fromAsset(join(__dirname, 'schema.graphql')),
      xrayEnabled: true,
      logConfig: {
        excludeVerboseContent: false,
        fieldLogLevel: FieldLogLevel.ALL,
      },
      domainName: {
        certificate,
        domainName,
      },
      authorizationConfig: {
        defaultAuthorization: {
          authorizationType: AuthorizationType.API_KEY,
          apiKeyConfig: {
            description: 'API Key',
            expires: cdk.Expiration.after(cdk.Duration.days(365)),
          },
        },
        additionalAuthorizationModes: [
          {
            authorizationType: AuthorizationType.OIDC,
            openIdConnectConfig: {
              oidcProvider: 'https://auth0.prosaist.io/',
            },
          },
        ],
      },
    });

    new CnameRecord(this, 'cname', {
      recordName: 'api',
      zone,
      domainName: api.appSyncDomainName,
    });

    const lambdaResolver = new NodejsFunction(this, 'resolver', {
      functionName: 'AccountResolver',
    });

    const datasource = api.addLambdaDataSource(
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
      removalPolicy: cdk.RemovalPolicy.DESTROY,
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

    new cdk.CfnOutput(this, 'graphqlUrl', { value: `${domainName}/graphql` });
    new cdk.CfnOutput(this, 'appsyncUrl', { value: api.graphqlUrl });
    if (api.apiKey) {
      new cdk.CfnOutput(this, 'apiKey', { value: api.apiKey });
    }
    new cdk.CfnOutput(this, 'apiId', { value: api.apiId });
    new cdk.CfnOutput(this, 'lambda', { value: lambdaResolver.functionArn });
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

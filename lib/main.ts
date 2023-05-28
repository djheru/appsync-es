import * as cdk from 'aws-cdk-lib';
import { FieldLogLevel, GraphqlApi, SchemaFile } from 'aws-cdk-lib/aws-appsync';
import { AttributeType, BillingMode, Table } from 'aws-cdk-lib/aws-dynamodb';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Construct } from 'constructs';
import { join } from 'path';
// import * as sqs from 'aws-cdk-lib/aws-sqs';

export class MainStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const api = new GraphqlApi(this, 'api', {
      name: 'AccountsApi',
      schema: SchemaFile.fromAsset(join(__dirname, 'schema.graphql')),
      xrayEnabled: true,
      logConfig: {
        excludeVerboseContent: false,
        fieldLogLevel: FieldLogLevel.ALL,
      },
    });

    const lambdaResolver = new NodejsFunction(this, 'resolver');
    const datasource = api.addLambdaDataSource('lambdaResolver', lambdaResolver);
    
    const fields = [
      { typeName: 'Query', fieldName: 'getAccount' },
      { typeName: 'Query', fieldName: 'listAccounts' },
      { typeName: 'Mutation', fieldName: 'createAccount' },
      { typeName: 'Mutation', fieldName: 'creditAccount' },
      { typeName: 'Mutation', fieldName: 'debitAccount' },
    ];

    fields.forEach(({ typeName, fieldName }) => 
      datasource.createResolver(`${typeName}${fieldName}Resolver`, {
        typeName, fieldName
      }));

    new cdk.CfnOutput(this, 'graphqlUrl', { value: api.graphqlUrl });
    if(api.apiKey){
      new cdk.CfnOutput(this, 'apiKey', { value: api.apiKey });
    }
    new cdk.CfnOutput(this, 'apiId', { value: api.apiId });
    new cdk.CfnOutput(this, 'lambda', { value: lambdaResolver.functionArn });

    const table = new Table(this, 'Table', {
      tableName: 'Accounts',
      partitionKey: { name: 'id', type: AttributeType.STRING },
      sortKey: { name: 'version', type: AttributeType.NUMBER },
      billingMode: BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: 'expires',
    });
    table.grantReadWriteData(lambdaResolver);

  }
}

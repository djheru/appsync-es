import {
  CfnOutput,
  Duration,
  Expiration,
  Stack,
  StackProps,
} from 'aws-cdk-lib';
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
import { CnameRecord, HostedZone } from 'aws-cdk-lib/aws-route53';
import { Construct } from 'constructs';
import { join } from 'path';

export class ApiStack extends Stack {
  public api: GraphqlApi;

  constructor(
    scope: Construct,
    id: string,
    private readonly props?: StackProps,
  ) {
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

    this.api = new GraphqlApi(this, 'api', {
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
            expires: Expiration.after(Duration.days(365)),
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
      domainName: this.api.appSyncDomainName,
    });

    new CfnOutput(this, 'apiId', { value: this.api.apiId });
    new CfnOutput(this, 'graphqlUrl', { value: `${domainName}/graphql` });
    new CfnOutput(this, 'appsyncUrl', { value: this.api.graphqlUrl });
    if (this.api.apiKey) {
      new CfnOutput(this, 'apiKey', { value: this.api.apiKey });
    }
  }
}

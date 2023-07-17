import { Stack, StackProps } from 'aws-cdk-lib';
import {
  CodePipeline,
  CodePipelineSource,
  ShellStep,
} from 'aws-cdk-lib/pipelines';
import { Construct } from 'constructs';
import { Application } from './application';

export interface PipelineStackProps extends StackProps {
  branchName: string;
  codestarConnectionArn: string;
  environmentName: string;
  githubRepo: string;
  githubOwner: string;
}

export class PipelineStack extends Stack {
  constructor(
    scope: Construct,
    id: string,
    private readonly props: PipelineStackProps,
  ) {
    super(scope, id, props);

    const pipeline = new CodePipeline(this, 'Pipeline', {
      synth: new ShellStep('Synth', {
        input: CodePipelineSource.connection(
          `${this.props.githubOwner}/${this.props.githubRepo}`,
          this.props.branchName,
          {
            connectionArn: this.props.codestarConnectionArn,
          },
        ),
        commands: ['npm ci', 'npm run build', 'npx cdk synth'],
      }),
    });

    pipeline.addStage(
      new Application(this, 'Application', {
        env: this.props.env,
      }),
    );
  }
}

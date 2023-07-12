import { Context, DynamoDBStreamEvent } from 'aws-lambda';

exports.handler = async (event: DynamoDBStreamEvent, ctx: Context) => {
  console.log('event: %j', event);
  console.log('ctx: %j', ctx);
};

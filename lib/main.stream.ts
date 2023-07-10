import { AttributeValue } from '@aws-sdk/client-dynamodb';
import {
  EventBridgeClient,
  PutEventsCommand,
} from '@aws-sdk/client-eventbridge';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import { Context, DynamoDBRecord, DynamoDBStreamEvent } from 'aws-lambda';

const client = new EventBridgeClient({});

exports.handler = async (event: DynamoDBStreamEvent, ctx: Context) => {
  console.log('event: %j', event);
  console.log('ctx: %j', ctx);

  const mappedEvents = event.Records.map((record: DynamoDBRecord) => ({
    Detail: JSON.stringify(
      unmarshall(
        (record.dynamodb?.NewImage || {}) as Record<string, AttributeValue>,
      ),
    ),
    DetailType: 'CREATED',
    Source: 'myapp.accounts',
    EventBusName: process.env.EVENT_BUS_NAME,
    Resources: [record.eventSourceARN || ''],
  }));

  console.log('mappedEvents: %j', mappedEvents);

  await client.send(
    new PutEventsCommand({
      Entries: mappedEvents,
    }),
  );
};

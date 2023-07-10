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

  const mappedEvents = event.Records.map((record: DynamoDBRecord) => {
    const data = unmarshall(
      (record.dynamodb?.NewImage || {}) as Record<string, AttributeValue>,
    );

    console.log('Record data: %j', data);

    return {
      Detail: JSON.stringify(data),
      DetailType: data.type,
      Source: 'myapp.accounts',
      EventBusName: process.env.EVENT_BUS_NAME,
      Resources: [record.eventSourceARN || ''],
    };
  });

  console.log('mappedEvents: %j', mappedEvents);

  await client.send(
    new PutEventsCommand({
      Entries: mappedEvents,
    }),
  );
};

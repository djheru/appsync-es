import { DynamoDBClient, QueryCommand } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  TransactWriteCommand,
  TransactWriteCommandInput,
} from '@aws-sdk/lib-dynamodb';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import * as https from 'https';
import {
  AccountEvent,
  AccountSnapshotEvent,
  CreateAccountEvent,
  CreditAccountEvent,
  DebitAccountEvent,
  EventType,
} from '../models/account';

const { TABLE_NAME: TableName = '' } = process.env;

const agent = new https.Agent({
  keepAlive: true,
  maxSockets: 50,
  rejectUnauthorized: true,
});
agent.setMaxListeners(0);

const client = new DynamoDBClient({});
const ddb = DynamoDBDocumentClient.from(client);

export const createAccount = async (createEvent: CreateAccountEvent) => {
  const transaction: TransactWriteCommandInput = {
    TransactItems: [],
  };

  transaction.TransactItems?.push({
    Put: {
      TableName,
      ConditionExpression: 'attribute_not_exists(id)',
      Item: createEvent,
    },
  });

  const accountSnapshot: AccountSnapshotEvent = {
    ...createEvent,
    version: 2,
    type: EventType.SNAPSHOT,
  };

  transaction.TransactItems?.push({
    Put: {
      TableName,
      ConditionExpression: 'attribute_not_exists(version)',
      Item: accountSnapshot,
    },
  });

  const command = new TransactWriteCommand(transaction);

  await ddb.send(command);
};

export const creditAccount = async (
  creditEvent: CreditAccountEvent,
  snapshotEvent?: AccountSnapshotEvent,
) => {
  const transaction: TransactWriteCommandInput = {
    TransactItems: [],
  };

  if (snapshotEvent) {
    transaction.TransactItems?.push({
      Put: {
        TableName,
        ConditionExpression: 'attribute_not_exists(version)',
        Item: snapshotEvent,
      },
    });
  }

  transaction.TransactItems?.push({
    Put: {
      TableName,
      ConditionExpression: 'attribute_not_exists(version)',
      Item: creditEvent,
    },
  });

  const command = new TransactWriteCommand(transaction);

  await ddb.send(command);
};

export const debitAccount = async (
  debitEvent: DebitAccountEvent,
  snapshotEvent?: AccountSnapshotEvent,
) => {
  const transaction: TransactWriteCommandInput = {
    TransactItems: [],
  };

  if (snapshotEvent) {
    transaction.TransactItems?.push({
      Put: {
        TableName,
        ConditionExpression: 'attribute_not_exists(version)',
        Item: snapshotEvent,
      },
    });
  }

  transaction.TransactItems?.push({
    Put: {
      TableName,
      ConditionExpression: 'attribute_not_exists(version)',
      Item: debitEvent,
    },
  });

  const command = new TransactWriteCommand(transaction);

  await ddb.send(command);
};

export const getAccountEvents = async (id: string) => {
  const command = new QueryCommand({
    TableName,
    KeyConditionExpression: 'id = :id',
    ExpressionAttributeValues: { ':id': { S: id } },
    ConsistentRead: true,
    Limit: 10,
    ScanIndexForward: false, // most recent first
  });
  const stream = await ddb.send(command);

  const items = (stream.Items || []).map((item) =>
    unmarshall(item),
  ) as AccountEvent[];

  if (!items || !items.length) {
    console.log(`Account ID ${id} not found`);
    return [];
  }

  return items;
};

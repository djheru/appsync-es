import { DynamoDBClient, QueryCommand } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  QueryCommandOutput,
  TransactWriteCommand,
  TransactWriteCommandInput,
} from '@aws-sdk/lib-dynamodb';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import * as https from 'https';
import {
  AccountEvent,
  AccountListItemType,
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
      Item: formatEventItem(createEvent),
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
      Item: formatEventItem(accountSnapshot),
    },
  });

  const accountListItem: AccountListItemType = {
    auth0Id: createEvent.auth0Id,
    email: createEvent.email,
    id: createEvent.id,
  };

  transaction.TransactItems?.push({
    Put: {
      TableName,
      Item: formatAccountListItem(accountListItem),
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
        Item: formatEventItem(snapshotEvent),
      },
    });
  }

  transaction.TransactItems?.push({
    Put: {
      TableName,
      ConditionExpression: 'attribute_not_exists(version)',
      Item: formatEventItem(creditEvent),
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
        Item: formatEventItem(snapshotEvent),
      },
    });
  }

  transaction.TransactItems?.push({
    Put: {
      TableName,
      ConditionExpression: 'attribute_not_exists(version)',
      Item: formatEventItem(debitEvent),
    },
  });

  const command = new TransactWriteCommand(transaction);

  await ddb.send(command);
};

export const formatEventItem = (item: AccountEvent, itemType = 'event') => ({
  pk: `${itemType}#${item.id}`,
  sk: `${itemType}#${item.version}`,
  ...item,
});

export const formatAccountListItem = (item: AccountListItemType) => ({
  pk: 'account',
  sk: `account#${item.email}`,
  ...item,
});

export const getAccountList = async (pageSize = 3, token?: string) => {
  const command = new QueryCommand({
    TableName,
    KeyConditionExpression: '#pk = :pk',
    ExpressionAttributeNames: { '#pk': 'pk' },
    ExpressionAttributeValues: { ':pk': { S: 'account' } },
    ConsistentRead: true,
    Limit: pageSize,
  });

  if (token) {
    command.input.ExclusiveStartKey = JSON.parse(
      Buffer.from(token, 'base64').toString(),
    );
  }
  const accountResults: QueryCommandOutput = await ddb.send(command);

  const accounts = (accountResults.Items || []).map((account) =>
    unmarshall(account),
  ) as AccountListItemType[];

  if (!accounts || !accounts.length) {
    console.log('No accounts found');
    return { accounts: [] as AccountListItemType[], nextToken: undefined };
  }

  const nextToken = accountResults.LastEvaluatedKey
    ? Buffer.from(JSON.stringify(accountResults.LastEvaluatedKey)).toString(
        'base64',
      )
    : undefined;

  return { accounts, nextToken };
};

export const getAccountEvents = async (id: string) => {
  const command = new QueryCommand({
    TableName,
    KeyConditionExpression: 'pk = :pk',
    ExpressionAttributeValues: { ':pk': { S: `event#${id}` } },
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

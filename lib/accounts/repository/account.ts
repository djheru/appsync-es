// AWS SDK and utilities for DynamoDB operations
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

// https agent settings
const agent = new https.Agent({
  keepAlive: true,
  maxSockets: 50,
  rejectUnauthorized: true,
});
agent.setMaxListeners(0);

const client = new DynamoDBClient({});
const ddb = DynamoDBDocumentClient.from(client);

/**
 * Function to create a new account. It performs three operations as a transaction:
 * 1. Inserts a 'create' event.
 * 2. Inserts an initial 'snapshot' event.
 * 3. Inserts the account into the account list.
 * @param createEvent the account creation event.
 */
export const createAccount = async (createEvent: CreateAccountEvent) => {
  const transaction: TransactWriteCommandInput = {
    TransactItems: [],
  };

  // add create event
  transaction.TransactItems?.push({
    Put: {
      TableName,
      ConditionExpression: 'attribute_not_exists(pk)',
      Item: formatCreateItem(createEvent),
    },
  });

  // create initial snapshot event
  const accountSnapshot: AccountSnapshotEvent = {
    ...createEvent,
    version: 2,
    type: EventType.SNAPSHOT,
  };

  transaction.TransactItems?.push({
    Put: {
      TableName,
      ConditionExpression: 'attribute_not_exists(sk)',
      Item: formatEventItem(accountSnapshot),
    },
  });

  const command = new TransactWriteCommand(transaction);

  try {
    await ddb.send(command);
  } catch (error) {
    console.error(`Failed to create account: ${error}`);
    throw error;
  }
};

/**
 * Function to credit an account. It performs the credit operation as a transaction and inserts a snapshot event if needed.
 * @param creditEvent the credit event.
 * @param snapshotEvent the snapshot event if needed.
 */
export const creditAccount = async (
  creditEvent: CreditAccountEvent,
  snapshotEvent?: AccountSnapshotEvent,
) => {
  const transaction: TransactWriteCommandInput = {
    TransactItems: [],
  };

  // if snapshotEvent exists, push it to transaction
  if (snapshotEvent) {
    transaction.TransactItems?.push({
      Put: {
        TableName,
        ConditionExpression: 'attribute_not_exists(sk)',
        Item: formatEventItem(snapshotEvent),
      },
    });
  }

  // push creditEvent to transaction
  transaction.TransactItems?.push({
    Put: {
      TableName,
      ConditionExpression: 'attribute_not_exists(sk)',
      Item: formatEventItem(creditEvent),
    },
  });

  const command = new TransactWriteCommand(transaction);

  try {
    await ddb.send(command);
  } catch (error) {
    console.error(`Failed to credit account: ${error}`);
    throw error;
  }
};

/**
 * Function to debit an account. It performs the debit operation as a transaction and inserts a snapshot event if needed.
 * @param debitEvent the debit event.
 * @param snapshotEvent the snapshot event if needed.
 */
export const debitAccount = async (
  debitEvent: DebitAccountEvent,
  snapshotEvent?: AccountSnapshotEvent,
) => {
  const transaction: TransactWriteCommandInput = {
    TransactItems: [],
  };

  // if snapshotEvent exists, push it to transaction
  if (snapshotEvent) {
    transaction.TransactItems?.push({
      Put: {
        TableName,
        ConditionExpression: 'attribute_not_exists(sk)',
        Item: formatEventItem(snapshotEvent),
      },
    });
  }

  // push debitEvent to transaction
  transaction.TransactItems?.push({
    Put: {
      TableName,
      ConditionExpression: 'attribute_not_exists(sk)',
      Item: formatEventItem(debitEvent),
    },
  });

  const command = new TransactWriteCommand(transaction);

  try {
    await ddb.send(command);
  } catch (error) {
    console.error(`Failed to debit account: ${error}`);
    throw error;
  }
};

/**
 * Helper function to format event item for DynamoDB
 * @param item the event item to be formatted
 * @param itemType the type of the item
 */
export const formatEventItem = (item: AccountEvent, itemType = 'event') => ({
  pk: `${itemType}#${item.id}`,
  sk: `${itemType}#${item.version}`,
  ...item,
});

/**
 * Helper function to format account creation item for DynamoDB
 * It needs to also write to the GSI
 * @param item the account list item to be formatted
 */
export const formatCreateItem = (
  item: CreateAccountEvent,
  itemType = 'event',
) => ({
  pk: `${itemType}#${item.id}`,
  sk: `${itemType}#${item.version}`,
  gsi_pk: 'account',
  gsi_sk: `${item.email}#${item.auth0Id}#${item.id}`,
  ...item,
});

/**
 * Function to get list of accounts in a paginated way
 * @param pageSize the number of accounts to return per page
 * @param token the token to specify a specific page
 */
export const getAccountList = async (pageSize = 3, token?: string) => {
  const command = new QueryCommand({
    TableName,
    IndexName: `${TableName}GSI`,
    KeyConditionExpression: '#gsi_pk = :gsi_pk',
    ExpressionAttributeNames: { '#gsi_pk': 'gsi_pk' },
    ExpressionAttributeValues: { ':gsi_pk': { S: 'account' } },
    Limit: pageSize,
  });

  if (token) {
    command.input.ExclusiveStartKey = JSON.parse(
      Buffer.from(token, 'base64').toString(),
    );
  }
  const accountResults: QueryCommandOutput = await ddb.send(command);

  console.log('getAccountList results: %j', accountResults);

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

/**
 * Function to get list of account events
 * @param id the ID of the account
 */
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

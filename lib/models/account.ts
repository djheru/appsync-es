import { DynamoDBClient, QueryCommand } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  TransactWriteCommand,
  TransactWriteCommandInput,
} from '@aws-sdk/lib-dynamodb';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import * as https from 'https';
import * as _ from 'lodash';

const { TABLE_NAME: TableName = '' } = process.env;

const agent = new https.Agent({
  keepAlive: true,
  maxSockets: 50,
  rejectUnauthorized: true,
});
agent.setMaxListeners(0);

const client = new DynamoDBClient({});
const ddb = DynamoDBDocumentClient.from(client);

export enum EventType {
  CREATED = 'CREATED',
  CREDITED = 'CREDITED',
  DEBITED = 'DEBITED',
  SNAPSHOT = 'SNAPSHOT',
}

export type Account = {
  auth0Id: string;
  availableTokens: number;
  email: string;
  id: string;
  timestamp: string;
  version: number;
};

export type GetAccountInputType = {
  id: string;
};
export type ListAccountsInputType = {
  limit?: number;
  nextToken?: string;
};
export type CreateAccountInputType = {
  auth0Id: string;
  email: string;
};
export type CreditDebitAccountInputType = {
  id: string;
  amount: number;
};

export type CreateAccountEvent = {
  auth0Id: string;
  availableTokens: number;
  email: string;
  id: string;
  timestamp: string;
  type: EventType.CREATED;
  version: number;
};

export type AccountSnapshotEvent = {
  auth0Id: string;
  availableTokens: number;
  email: string;
  id: string;
  timestamp: string;
  type: EventType.SNAPSHOT;
  version: number;
};

export type CreditAccountEvent = {
  amount: number;
  id: string;
  timestamp: string;
  type: EventType.CREDITED;
  version: number;
};

export type DebitAccountEvent = {
  amount: number;
  id: string;
  timestamp: string;
  type: EventType.DEBITED;
  version: number;
};

export type AccountEvent =
  | CreateAccountEvent
  | AccountSnapshotEvent
  | CreditAccountEvent
  | DebitAccountEvent;

export const create = async (id: string, input: CreateAccountInputType) => {
  const { auth0Id, email } = input;

  const transaction: TransactWriteCommandInput = {
    TransactItems: [],
  };

  const createEvent: CreateAccountEvent = {
    auth0Id,
    availableTokens: 1,
    email,
    id,
    timestamp: new Date().toJSON(),
    type: EventType.CREATED,
    version: 1,
  };

  transaction.TransactItems?.push({
    Put: {
      TableName,
      ConditionExpression:
        'attribute_not_exists(id) and attribute_not_exists(email)',
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
  return accountSnapshot;
};

export const credit = async (
  event: CreditDebitAccountInputType,
  currentAccount: Account,
  itemsSinceSnapshot: AccountEvent[],
) => {
  const transaction: TransactWriteCommandInput = {
    TransactItems: [],
  };

  let version = currentAccount.version;

  if (itemsSinceSnapshot.length >= 9) {
    transaction.TransactItems?.push({
      Put: {
        TableName,
        ConditionExpression: 'attribute_not_exists(version)',
        Item: {
          ...currentAccount,
          version: ++version,
        },
      },
    });
  }

  const creditAccountEvent: CreditAccountEvent = {
    id: event.id,
    version: ++version,
    type: EventType.CREDITED,
    amount: event.amount,
    timestamp: new Date().toJSON(),
  };

  transaction.TransactItems?.push({
    Put: {
      TableName,
      ConditionExpression: 'attribute_not_exists(version)',
      Item: creditAccountEvent,
    },
  });

  const command = new TransactWriteCommand(transaction);

  await ddb.send(command);
  const updated = await get(event.id);
  return updated?.account;
};

export const debit = async (
  event: CreditDebitAccountInputType,
  currentAccount: Account,
  itemsSinceSnapshot: AccountEvent[],
) => {
  if (currentAccount.availableTokens < event.amount) {
    throw new Error('Insufficient tokens for debit');
  }

  const transaction: TransactWriteCommandInput = {
    TransactItems: [],
  };

  let version = currentAccount.version;

  if (itemsSinceSnapshot.length >= 9) {
    transaction.TransactItems?.push({
      Put: {
        TableName,
        ConditionExpression: 'attribute_not_exists(version)',
        Item: {
          ...currentAccount,
          version: ++version,
        },
      },
    });
  }

  const debitAccountEvent: DebitAccountEvent = {
    id: event.id,
    version: ++version,
    type: EventType.DEBITED,
    amount: event.amount,
    timestamp: new Date().toJSON(),
  };

  transaction.TransactItems?.push({
    Put: {
      TableName,
      ConditionExpression: 'attribute_not_exists(version)',
      Item: debitAccountEvent,
    },
  });

  const command = new TransactWriteCommand(transaction);

  await ddb.send(command);
  const updated = await get(event.id);
  return updated?.account;
};

export const get = async (id: string) => {
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
    return null;
  }

  const snapshotIdx = items?.findIndex(
    (item) => item.type === EventType.SNAPSHOT,
  );
  const snapshot = items[snapshotIdx] as Account;

  if (!snapshot) {
    console.log(`Account ID ${id} not found`);
    return null;
  }

  const itemsSinceSnapshot: AccountEvent[] = _.reverse(
    _.range(0, snapshotIdx).map((idx) => items[idx]),
  );

  const account = itemsSinceSnapshot.reduce(
    (state: Account, item: AccountEvent) => {
      let availableTokens = state.availableTokens;
      const version = item.version;

      if (item.type === EventType.DEBITED) {
        availableTokens -= item.amount || 0;
      } else if (item.type === EventType.CREDITED) {
        availableTokens += item.amount || 0;
      }
      return { ...state, availableTokens, version };
    },
    { ...snapshot } as Account,
  );

  return {
    account,
    snapshot,
    itemsSinceSnapshot,
  };
};

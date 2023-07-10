import { DynamoDB } from 'aws-sdk';
import * as https from 'https';
import * as _ from 'lodash';

const { TABLE_NAME: TableName = '' } = process.env;

const agent = new https.Agent({
  keepAlive: true,
  maxSockets: 50,
  rejectUnauthorized: true,
});
agent.setMaxListeners(0);

const ddb = new DynamoDB.DocumentClient({
  service: new DynamoDB({ httpOptions: { agent } }),
});

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

  const transaction: DynamoDB.DocumentClient.TransactWriteItemsInput = {
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

  transaction.TransactItems.push({
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

  transaction.TransactItems.push({
    Put: {
      TableName,
      ConditionExpression: 'attribute_not_exists(version)',
      Item: accountSnapshot,
    },
  });

  await ddb.transactWrite(transaction).promise();
  return accountSnapshot;
};

export const credit = async (
  event: CreditDebitAccountInputType,
  currentAccount: Account,
  itemsSinceSnapshot: AccountEvent[],
) => {
  const transaction: DynamoDB.DocumentClient.TransactWriteItemsInput = {
    TransactItems: [],
  };

  let version = currentAccount.version;

  if (itemsSinceSnapshot.length >= 9) {
    transaction.TransactItems.push({
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

  transaction.TransactItems.push({
    Put: {
      TableName,
      ConditionExpression: 'attribute_not_exists(version)',
      Item: creditAccountEvent,
    },
  });

  await ddb.transactWrite(transaction).promise();
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

  const transaction: DynamoDB.DocumentClient.TransactWriteItemsInput = {
    TransactItems: [],
  };

  let version = currentAccount.version;

  if (itemsSinceSnapshot.length >= 9) {
    transaction.TransactItems.push({
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

  transaction.TransactItems.push({
    Put: {
      TableName,
      ConditionExpression: 'attribute_not_exists(version)',
      Item: debitAccountEvent,
    },
  });

  await ddb.transactWrite(transaction).promise();
  const updated = await get(event.id);
  return updated?.account;
};

export const get = async (id: string) => {
  const stream = await ddb
    .query({
      TableName,
      KeyConditionExpression: 'id = :id',
      ExpressionAttributeValues: { ':id': id },
      ConsistentRead: true,
      Limit: 10,
      ScanIndexForward: false, // most recent first
    })
    .promise();

  const items = stream.Items as AccountEvent[];

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

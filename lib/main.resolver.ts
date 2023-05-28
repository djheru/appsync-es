import { AppSyncResolverEvent } from 'aws-lambda';

type GetAccountType = {
  id: string
};
type ListAccountsType = {
  limit?: number;
  nextToken?: string;
}
type CreateAccountType = {
  auth0Id: string;
  email: string;
}
type CreditDebitAccountType = {
  id: string;
  amount: number;
}

const getAccount = async ({ id }: GetAccountType) => {
  console.log('getAccount: %j', id);
};
const listAccounts = async ({ limit, nextToken }: ListAccountsType) => {
  console.log('listAccounts: %j', {limit, nextToken});
};
const createAccount = async ({ auth0Id, email }: CreateAccountType) => {
  console.log('createAccount: %j', {auth0Id, email});
};
const creditAccount = async ({ id, amount}: CreditDebitAccountType) => {
  console.log('creditAccount: %j', {id, amount});
};

const debitAccount = async ({ id, amount }: CreditDebitAccountType) => {
  console.log('debitAccount: %j', {id, amount});
};

// eslint-disable-next-line @typescript-eslint/ban-types
const operations: { [key: string]: { [key: string]: Function }} = {
  Query: { getAccount, listAccounts },
  Mutation: { createAccount, creditAccount, debitAccount }
};

exports.handler = async (event: AppSyncResolverEvent<{ [key: string]: string | number }>) => {
  console.log('event: %j' ,event);
  const {
    arguments: args,
    info: { parentTypeName: typeName, fieldName }
  } = event;

  const type = operations[typeName];
  if (type) {
    const operation = type[fieldName];
    if (operation) {
      return operation(args);
    }
  }
  throw new Error('unknown operation');
  
};
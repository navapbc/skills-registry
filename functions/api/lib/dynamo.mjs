import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
  DeleteCommand,
  ScanCommand,
  QueryCommand,
  BatchGetCommand,
} from '@aws-sdk/lib-dynamodb';

const client = new DynamoDBClient({ region: process.env.AWS_REGION ?? 'us-east-1' });
export const ddb = DynamoDBDocumentClient.from(client);

export const tables = {
  skills: () => process.env.SKILLS_TABLE,
  plugins: () => process.env.PLUGINS_TABLE,
  users: () => process.env.USERS_TABLE,
  audit: () => process.env.AUDIT_TABLE,
};

// Fast path for auth middleware: GetItem (read) on every request, write only on first login.
export async function getOrCreateUser({ user_id, email, name, avatar_url }) {
  const existing = await ddb.send(new GetCommand({
    TableName: tables.users(),
    Key: { user_id },
  }));

  if (existing.Item) return existing.Item;

  const now = new Date().toISOString();
  const newUser = { user_id, email, name, avatar_url, role: 'user', created_at: now, last_seen_at: now };

  try {
    await ddb.send(new PutCommand({
      TableName: tables.users(),
      Item: newUser,
      ConditionExpression: 'attribute_not_exists(user_id)',
    }));
  } catch (err) {
    if (err.name === 'ConditionalCheckFailedException') {
      const refetch = await ddb.send(new GetCommand({ TableName: tables.users(), Key: { user_id } }));
      return refetch.Item;
    }
    throw err;
  }

  return newUser;
}

// Full upsert used by /api/users/me to refresh profile fields on explicit request.
export async function upsertUser({ user_id, email, name, avatar_url }) {
  const now = new Date().toISOString();

  const result = await ddb.send(
    new UpdateCommand({
      TableName: tables.users(),
      Key: { user_id },
      UpdateExpression: `SET
        email = :email,
        #name = :name,
        avatar_url = :avatar_url,
        last_seen_at = :now,
        #role = if_not_exists(#role, :defaultRole),
        created_at = if_not_exists(created_at, :now)`,
      ExpressionAttributeNames: { '#name': 'name', '#role': 'role' },
      ExpressionAttributeValues: {
        ':email': email,
        ':name': name,
        ':avatar_url': avatar_url,
        ':now': now,
        ':defaultRole': 'user',
      },
      ReturnValues: 'ALL_NEW',
    })
  );

  return result.Attributes;
}

export { GetCommand, PutCommand, UpdateCommand, DeleteCommand, ScanCommand, QueryCommand, BatchGetCommand };

const AWS = require("aws-sdk");
AWS.config.update({ region: "us-west-1" });

const docClient = new AWS.DynamoDB.DocumentClient({ apiVersion: "2012-08-10" });
const dynamodb = new AWS.DynamoDB();

const tablename = "jobsort";

const insertIntoDatabase = async function insertIntoDatabase(dbValues) {
  const formattedDbValues = dbValues
    .map((val, idx) => {
      val.id = idx;
      return val;
    })
    .reduce((acc, val, i) => {
      if (i % 25 === 0) {
        acc.push({
          RequestItems: {
            [tablename]: []
          }
        });
      }
      acc[acc.length - 1].RequestItems[tablename].push({
        PutRequest: { Item: val }
      });
      return acc;
    }, []);
  await waitUntil("tableExists");

  const promises = formattedDbValues.map(val => {
    return new Promise(async (resolve, reject) => {
      try {
        await singleInsertIntoDatabase(val);
        resolve();
      } catch (err) {
        reject(err);
      }
    });
  });
  return Promise.all(promises);
};

function waitUntil(waitType) {
  return new Promise((resolve, reject) => {
    dynamodb.waitFor(waitType, { TableName: tablename }, function(err) {
      if (err) {
        console.log("Error waiting for new table...");
        reject(err);
      } else {
        resolve();
      }
    });
  });
}

const singleInsertIntoDatabase = function insertIntoDatabase(params) {
  console.log("Executing a single insert...");
  return new Promise((resolve, reject) => {
    docClient.batchWrite(params, function(err, data) {
      if (err) {
        reject(err);
      } else {
        resolve(data);
      }
    });
  });
};

const clearDatabase = async function clearDatabase() {
  try {
    await deleteTable();
    console.log("Successfully deleted table");
  } catch (err) {
    console.log("Error deleting table");
    console.log(err);
  }
  try {
    await createTable();
    console.log("Successfully created table");
  } catch (err) {
    console.log("Error creating table");
    console.log(err);
  }
};

function deleteTable() {
  var params = {
    TableName: tablename
  };
  return new Promise((resolve, reject) => {
    dynamodb.deleteTable(params, function(err, data) {
      if (err) {
        console.log(err);
        reject(err);
      } else {
        resolve(data);
      }
    });
  });
}

async function createTable() {
  var params = {
    TableName: tablename,
    KeySchema: [
      { AttributeName: "id", KeyType: "HASH" } //Partition key
    ],
    AttributeDefinitions: [{ AttributeName: "id", AttributeType: "N" }],
    ProvisionedThroughput: {
      ReadCapacityUnits: 10,
      WriteCapacityUnits: 10
    }
  };
  await waitUntil("tableNotExists");

  return new Promise((resolve, reject) => {
    dynamodb.createTable(params, function(err, data) {
      if (err) {
        reject(err);
      } else {
        resolve(data);
      }
    });
  });
}

const callSelectQuery = async function callSelectQuery() {
  var params = {
    TableName: tablename
  };
  return new Promise((resolve, reject) => {
    docClient.scan(params, function(err, data) {
      if (err) {
        reject(err);
      } else {
        console.log("Received all documents...");
        console.log({ data });
        resolve(data.Items);
      }
    });
  });
};

module.exports = {
  clearDatabase,
  insertIntoDatabase,
  callSelectQuery
};

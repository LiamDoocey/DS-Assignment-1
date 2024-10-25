import * as cdk from "aws-cdk-lib";
import * as lambdanode from "aws-cdk-lib/aws-lambda-nodejs";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as custom from "aws-cdk-lib/custom-resources";
import * as apig from "aws-cdk-lib/aws-apigateway";
import { Construct } from "constructs";
// import * as sqs from 'aws-cdk-lib/aws-sqs';
import { generateBatch } from "../shared/util";
import { movies, movieCasts } from "../seed/movies";

export class RestAPIStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Tables 
    const moviesTable = new dynamodb.Table(this, "MoviesTable", {
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      partitionKey: { name: "id", type: dynamodb.AttributeType.NUMBER },
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      tableName: "Movies",
    });

    const movieCastTable = new dynamodb.Table(this, "MovieCastTable", {
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      partitionKey: { name: "movieId", type: dynamodb.AttributeType.NUMBER },
      sortKey: { name: "actorName", type: dynamodb.AttributeType.STRING },
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      tableName: "MovieCast",
    });

    movieCastTable.addLocalSecondaryIndex({
      indexName: "roleIx",
      sortKey: { name: "roleName", type: dynamodb.AttributeType.STRING },
    });

    
    // Functions 
    const getMovieByIdFn = new lambdanode.NodejsFunction(
      this,
      "GetMovieByIdFn",
      {
        architecture: lambda.Architecture.ARM_64,
        runtime: lambda.Runtime.NODEJS_18_X,
        entry: `${__dirname}/../lambdas/getMovieById.ts`,
        timeout: cdk.Duration.seconds(10),
        memorySize: 128,
        environment: {
          TABLE_NAME: moviesTable.tableName,
          REGION: 'eu-west-1',
        },
      }
      );
      
      const getAllMoviesFn = new lambdanode.NodejsFunction(
        this,
        "GetAllMoviesFn",
        {
          architecture: lambda.Architecture.ARM_64,
          runtime: lambda.Runtime.NODEJS_18_X,
          entry: `${__dirname}/../lambdas/getAllMovies.ts`,
          timeout: cdk.Duration.seconds(10),
          memorySize: 128,
          environment: {
            TABLE_NAME: moviesTable.tableName,
            REGION: 'eu-west-1',
          },
        }
        );

        const newMovieFn = new lambdanode.NodejsFunction(this, "NewMovieFn", {
          architecture: lambda.Architecture.ARM_64,
          runtime: lambda.Runtime.NODEJS_18_X,
          entry: `${__dirname}/../lambdas/addMovie.ts`,
          timeout: cdk.Duration.seconds(10),
          memorySize: 128,
          environment: {
            TABLE_NAME: moviesTable.tableName,
            REGION: 'eu-west-1',
          },
        });

        const removeMovieFn = new lambdanode.NodejsFunction(this, "RemoveMovieFn", {
          architecture: lambda.Architecture.ARM_64,
          runtime: lambda.Runtime.NODEJS_18_X,
          entry: `${__dirname}/../lambdas/removeMovie.ts`,
          timeout: cdk.Duration.seconds(10),
          memorySize: 128,
          environment: {
            TABLE_NAME: moviesTable.tableName,
            REGION: 'eu-west-1',
          },
        });

        const getMovieCastMembersFn = new lambdanode.NodejsFunction(this, "GetMoviesCastMembersFn", {
          architecture: lambda.Architecture.ARM_64,
          runtime: lambda.Runtime.NODEJS_18_X,
          entry: `${__dirname}/../lambdas/getMovieCastMember.ts`,
          timeout: cdk.Duration.seconds(10),
          memorySize: 128,
          environment: {
            TABLE_NAME: movieCastTable.tableName,
            REGION: 'eu-west-1',
          },  
        });
        
        new custom.AwsCustomResource(this, "moviesddbInitData", {
          onCreate: {
            service: "DynamoDB",
            action: "batchWriteItem",
            parameters: {
              RequestItems: {
                [moviesTable.tableName]: generateBatch(movies),
                [movieCastTable.tableName]: generateBatch(movieCasts),
              },
            },
            physicalResourceId: custom.PhysicalResourceId.of("moviesddbInitData"), //.of(Date.now().toString()),
          },
          policy: custom.AwsCustomResourcePolicy.fromSdkCalls({
            resources: [moviesTable.tableArn, movieCastTable.tableArn],
          }),
        });
        
        // Permissions 
        moviesTable.grantReadData(getMovieByIdFn)
        moviesTable.grantReadData(getAllMoviesFn)
        moviesTable.grantReadWriteData(newMovieFn)
        moviesTable.grantReadWriteData(removeMovieFn)
        movieCastTable.grantReadData(getMovieCastMembersFn)

        // API Gateway
        const api = new apig.RestApi(this, "RestApi", {
          description: "demo api",
          deployOptions: {
            stageName: "dev",
          },
          defaultCorsPreflightOptions: {
            allowHeaders: ["Content-Type", "X-Amz-Date"],
            allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
            allowCredentials: true,
            allowOrigins: ["*"],
          },
        });

        const moviesEndpoint = api.root.addResource("movies");
        moviesEndpoint.addMethod(
          "GET", 
          new apig.LambdaIntegration(getAllMoviesFn, {proxy: true})
        );

        const movieEndpoint = moviesEndpoint.addResource("{movieId}");
        movieEndpoint.addMethod(
          "GET", 
          new apig.LambdaIntegration(getMovieByIdFn, {proxy: true})
        );

        moviesEndpoint.addMethod(
          "POST", 
          new apig.LambdaIntegration(newMovieFn, {proxy: true})
        );

        movieEndpoint.addMethod(
          "DELETE", 
          new apig.LambdaIntegration(removeMovieFn, {proxy: true})
        );

        const movieCastEndpoint = moviesEndpoint.addResource("cast");
        movieCastEndpoint.addMethod(
          "GET", 
          new apig.LambdaIntegration(getMovieCastMembersFn, {proxy: true})
        );
      }
    }
    
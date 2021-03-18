import * as cdk from '@aws-cdk/core';
import lambda = require('@aws-cdk/aws-lambda');
import destinations = require('@aws-cdk/aws-lambda-destinations');
import events = require('@aws-cdk/aws-events');
import events_targets = require('@aws-cdk/aws-events-targets');
import apigw = require('@aws-cdk/aws-apigateway');
import sns = require('@aws-cdk/aws-sns');
import sns_sub = require('@aws-cdk/aws-sns-subscriptions');
import iam = require('@aws-cdk/aws-iam');
import * as sqs from "@aws-cdk/aws-sqs";
import { Code, Function, Runtime } from "@aws-cdk/aws-lambda";
import * as cloudwatch from '@aws-cdk/aws-cloudwatch';


export class LambdaStack extends cdk.Stack {
  constructor(scope: cdk.Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    
    const bus = new events.EventBus(this, 'DestinedEventBus', {
      eventBusName: 'the-destined-lambda'
    })

  
    const topic = new sns.Topic(this, 'theDestinedLambdaTopic',
    {
      displayName: "The Destined Lambda CDK Pattern Topic"
    });

    const destinedLambda = new lambda.Function(this, 'destinedLambda', {
      runtime: lambda.Runtime.NODEJS_12_X,
      code: lambda.Code.fromAsset('lambda-fns'),
      handler: 'destinedLambda.handler',
      retryAttempts: 0,
      onSuccess: new destinations.EventBridgeDestination(bus),
      onFailure: new destinations.EventBridgeDestination(bus)
    });

    topic.addSubscription(new sns_sub.LambdaSubscription(destinedLambda))

    const successLambda = new lambda.Function(this, 'SuccessLambdaHandler', {
      runtime: lambda.Runtime.NODEJS_12_X,
      code: lambda.Code.fromAsset('lambda-fns'),
      handler: 'success.handler',
      timeout: cdk.Duration.seconds(3)
    });

   
    const successRule = new events.Rule(this, 'successRule', {
      eventBus: bus,
      description: 'all success events are caught here and logged centrally',
      eventPattern:
      {
        "detail": {
          "requestContext": {
            "condition": ["Success"]
          },
          "responsePayload": {
            "source": ["cdkpatterns.the-destined-lambda"],
            "action": ["message"]
          }
        }
      }
    });

    successRule.addTarget(new events_targets.LambdaFunction(successLambda));

    const myDeadLetterQueue = new sqs.Queue(this, 'Queue');
  
    const failureLambda = new lambda.Function(this, 'FailureLambdaHandler', {
      runtime: lambda.Runtime.NODEJS_12_X,
      code: lambda.Code.fromAsset('lambda-fns'),
      handler: 'failure.handler',
      timeout: cdk.Duration.seconds(3)
    });

    const alarm = new cloudwatch.Alarm(this,'Alarm',{
      metric: myDeadLetterQueue.metricApproximateNumberOfMessagesVisible(),
      threshold: 1,
      evaluationPeriods: 1
    })

   const failureRule = new events.Rule(this, 'failureRule', {
      eventBus: bus,
      description: 'all failure events are caught here and logged centrally',
      eventPattern:
      {
        "detail": {
          "responsePayload": {
            "errorType": ["Error"]
          }
        }
      }
    });

    const fn = new Function(this, 'MyFun',{
      runtime: Runtime.NODEJS_12_X,
      handler: 'index.handler',
      code: lambda.Code.fromInline('export.handler=${handler})')
    })

    failureRule.addTarget(new events_targets.LambdaFunction(failureLambda));
    failureRule.addTarget(new events_targets.LambdaFunction(fn,{
      deadLetterQueue: myDeadLetterQueue
    }));

    let gateway = new apigw.RestApi(this, 'theDestinedLambdaAPI', {
      deployOptions: {
        metricsEnabled: true,
        loggingLevel: apigw.MethodLoggingLevel.INFO,
        dataTraceEnabled: true,
        stageName: 'prod'
      }
    });

  
   let apigwSnsRole = new iam.Role(this, 'ApiGatewaySnsRole', {
      assumedBy: new iam.ServicePrincipal('apigateway.amazonaws.com')
    });
    topic.grantPublish(apigwSnsRole);

 
    const responseModel = gateway.addModel('ResponseModel', {
      contentType: 'application/json',
      modelName: 'ResponseModel',
      schema: { 'schema': apigw.JsonSchemaVersion.DRAFT4, 'title': 'pollResponse', 'type': apigw.JsonSchemaType.OBJECT, 'properties': { 'message': { 'type': apigw.JsonSchemaType.STRING } } }
    });
    
  
    const errorResponseModel = gateway.addModel('ErrorResponseModel', {
      contentType: 'application/json',
      modelName: 'ErrorResponseModel',
      schema: { 'schema': apigw.JsonSchemaVersion.DRAFT4, 'title': 'errorResponse', 'type': apigw.JsonSchemaType.OBJECT, 'properties': { 'state': { 'type': apigw.JsonSchemaType.STRING }, 'message': { 'type': apigw.JsonSchemaType.STRING } } }
    });

  
    gateway.root.addResource('SendEvent')
      .addMethod('GET', new apigw.Integration({
        type: apigw.IntegrationType.AWS, //native aws integration
        integrationHttpMethod: "POST",
        uri: 'arn:aws:apigateway:us-east-1:sns:path//', // This is how we setup an SNS Topic publish operation.
        options: {
          credentialsRole: apigwSnsRole,
          requestParameters: {
            'integration.request.header.Content-Type': "'application/x-www-form-urlencoded'" // Tell api gw to send our payload as query params
          },
          requestTemplates: {
      
            'application/json': "Action=Publish&"+
                              "TargetArn=$util.urlEncode('"+topic.topicArn+"')&"+
                              "Message=please $input.params().querystring.get('mode')&"+
                              "Version=2010-03-31"
        },
        passthroughBehavior: apigw.PassthroughBehavior.NEVER,
        integrationResponses: [
          {
            statusCode: "200",
            responseTemplates: {
              'application/json': JSON.stringify({ message: 'Message added to SNS topic'})
            }
          },
          {
            selectionPattern: '^\[Error\].*',
            statusCode: "400",
            responseTemplates: {
                'application/json': JSON.stringify({ state: 'error', message: "$util.escapeJavaScript($input.path('$.errorMessage'))" })
            },
            responseParameters: {
                'method.response.header.Content-Type': "'application/json'",
                'method.response.header.Access-Control-Allow-Origin': "'*'",
                'method.response.header.Access-Control-Allow-Credentials': "'true'"
            }
          }
        ]
        }
      }),
      {
        methodResponses: [ 
          {
          
            statusCode: '200',
            responseParameters: {
              'method.response.header.Content-Type': true,
              'method.response.header.Access-Control-Allow-Origin': true,
              'method.response.header.Access-Control-Allow-Credentials': true
            },
           responseModels: {
              'application/json': responseModel
            }
          },
          {
            statusCode: '400',
            responseParameters: {
              'method.response.header.Content-Type': true,
              'method.response.header.Access-Control-Allow-Origin': true,
              'method.response.header.Access-Control-Allow-Credentials': true
            },
            responseModels: {
              'application/json': errorResponseModel
            }
          }
        ]
      })
  }
}

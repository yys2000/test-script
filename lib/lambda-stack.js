"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LambdaStack = void 0;
const cdk = require("@aws-cdk/core");
const lambda = require("@aws-cdk/aws-lambda");
const destinations = require("@aws-cdk/aws-lambda-destinations");
const events = require("@aws-cdk/aws-events");
const events_targets = require("@aws-cdk/aws-events-targets");
const apigw = require("@aws-cdk/aws-apigateway");
const sns = require("@aws-cdk/aws-sns");
const sns_sub = require("@aws-cdk/aws-sns-subscriptions");
const iam = require("@aws-cdk/aws-iam");
const sqs = require("@aws-cdk/aws-sqs");
const aws_lambda_1 = require("@aws-cdk/aws-lambda");
const cloudwatch = require("@aws-cdk/aws-cloudwatch");
class LambdaStack extends cdk.Stack {
    constructor(scope, id, props) {
        super(scope, id, props);
        const bus = new events.EventBus(this, 'DestinedEventBus', {
            eventBusName: 'the-destined-lambda'
        });
        const topic = new sns.Topic(this, 'theDestinedLambdaTopic', {
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
        topic.addSubscription(new sns_sub.LambdaSubscription(destinedLambda));
        const successLambda = new lambda.Function(this, 'SuccessLambdaHandler', {
            runtime: lambda.Runtime.NODEJS_12_X,
            code: lambda.Code.fromAsset('lambda-fns'),
            handler: 'success.handler',
            timeout: cdk.Duration.seconds(3)
        });
        const successRule = new events.Rule(this, 'successRule', {
            eventBus: bus,
            description: 'all success events are caught here and logged centrally',
            eventPattern: {
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
        const alarm = new cloudwatch.Alarm(this, 'Alarm', {
            metric: myDeadLetterQueue.metricApproximateNumberOfMessagesVisible(),
            threshold: 1,
            evaluationPeriods: 1
        });
        const failureRule = new events.Rule(this, 'failureRule', {
            eventBus: bus,
            description: 'all failure events are caught here and logged centrally',
            eventPattern: {
                "detail": {
                    "responsePayload": {
                        "errorType": ["Error"]
                    }
                }
            }
        });
        const fn = new aws_lambda_1.Function(this, 'MyFun', {
            runtime: aws_lambda_1.Runtime.NODEJS_12_X,
            handler: 'index.handler',
            code: lambda.Code.fromInline('export.handler=${handler})')
        });
        failureRule.addTarget(new events_targets.LambdaFunction(failureLambda));
        failureRule.addTarget(new events_targets.LambdaFunction(fn, {
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
            type: apigw.IntegrationType.AWS,
            integrationHttpMethod: "POST",
            uri: 'arn:aws:apigateway:us-east-1:sns:path//',
            options: {
                credentialsRole: apigwSnsRole,
                requestParameters: {
                    'integration.request.header.Content-Type': "'application/x-www-form-urlencoded'" // Tell api gw to send our payload as query params
                },
                requestTemplates: {
                    'application/json': "Action=Publish&" +
                        "TargetArn=$util.urlEncode('" + topic.topicArn + "')&" +
                        "Message=please $input.params().querystring.get('mode')&" +
                        "Version=2010-03-31"
                },
                passthroughBehavior: apigw.PassthroughBehavior.NEVER,
                integrationResponses: [
                    {
                        statusCode: "200",
                        responseTemplates: {
                            'application/json': JSON.stringify({ message: 'Message added to SNS topic' })
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
        }), {
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
        });
    }
}
exports.LambdaStack = LambdaStack;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibGFtYmRhLXN0YWNrLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsibGFtYmRhLXN0YWNrLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQUFBLHFDQUFxQztBQUNyQyw4Q0FBK0M7QUFDL0MsaUVBQWtFO0FBQ2xFLDhDQUErQztBQUMvQyw4REFBK0Q7QUFDL0QsaURBQWtEO0FBQ2xELHdDQUF5QztBQUN6QywwREFBMkQ7QUFDM0Qsd0NBQXlDO0FBQ3pDLHdDQUF3QztBQUN4QyxvREFBOEQ7QUFDOUQsc0RBQXNEO0FBR3RELE1BQWEsV0FBWSxTQUFRLEdBQUcsQ0FBQyxLQUFLO0lBQ3hDLFlBQVksS0FBb0IsRUFBRSxFQUFVLEVBQUUsS0FBc0I7UUFDbEUsS0FBSyxDQUFDLEtBQUssRUFBRSxFQUFFLEVBQUUsS0FBSyxDQUFDLENBQUM7UUFHeEIsTUFBTSxHQUFHLEdBQUcsSUFBSSxNQUFNLENBQUMsUUFBUSxDQUFDLElBQUksRUFBRSxrQkFBa0IsRUFBRTtZQUN4RCxZQUFZLEVBQUUscUJBQXFCO1NBQ3BDLENBQUMsQ0FBQTtRQUdGLE1BQU0sS0FBSyxHQUFHLElBQUksR0FBRyxDQUFDLEtBQUssQ0FBQyxJQUFJLEVBQUUsd0JBQXdCLEVBQzFEO1lBQ0UsV0FBVyxFQUFFLHVDQUF1QztTQUNyRCxDQUFDLENBQUM7UUFFSCxNQUFNLGNBQWMsR0FBRyxJQUFJLE1BQU0sQ0FBQyxRQUFRLENBQUMsSUFBSSxFQUFFLGdCQUFnQixFQUFFO1lBQ2pFLE9BQU8sRUFBRSxNQUFNLENBQUMsT0FBTyxDQUFDLFdBQVc7WUFDbkMsSUFBSSxFQUFFLE1BQU0sQ0FBQyxJQUFJLENBQUMsU0FBUyxDQUFDLFlBQVksQ0FBQztZQUN6QyxPQUFPLEVBQUUsd0JBQXdCO1lBQ2pDLGFBQWEsRUFBRSxDQUFDO1lBQ2hCLFNBQVMsRUFBRSxJQUFJLFlBQVksQ0FBQyxzQkFBc0IsQ0FBQyxHQUFHLENBQUM7WUFDdkQsU0FBUyxFQUFFLElBQUksWUFBWSxDQUFDLHNCQUFz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QUUsSUFBSSxDQUFDLFNBQVMsQ0FBQyxFQUFFLEtBQUssRUFBRSxPQUFPLEVBQUUsT0FBTyxFQUFFLHVEQUF1RCxFQUFFLENBQUM7eUJBQzNIO3dCQUNELGtCQUFrQixFQUFFOzRCQUNoQixxQ0FBcUMsRUFBRSxvQkFBb0I7NEJBQzNELG9EQUFvRCxFQUFFLEtBQUs7NEJBQzNELHlEQUF5RCxFQUFFLFFBQVE7eUJBQ3RFO3FCQUNGO2lCQUNGO2FBQ0E7U0FDRixDQUFDLEVBQ0Y7WUFDRSxlQUFlLEVBQUU7Z0JBQ2Y7b0JBRUUsVUFBVSxFQUFFLEtBQUs7b0JBQ2pCLGtCQUFrQixFQUFFO3dCQUNsQixxQ0FBcUMsRUFBRSxJQUFJO3dCQUMzQyxvREFBb0QsRUFBRSxJQUFJO3dCQUMxRCx5REFBeUQsRUFBRSxJQUFJO3FCQUNoRTtvQkFDRixjQUFjLEVBQUU7d0JBQ2Isa0JBQWtCLEVBQUUsYUFBYTtxQkFDbEM7aUJBQ0Y7Z0JBQ0Q7b0JBQ0UsVUFBVSxFQUFFLEtBQUs7b0JBQ2pCLGtCQUFrQixFQUFFO3dCQUNsQixxQ0FBcUMsRUFBRSxJQUFJO3dCQUMzQyxvREFBb0QsRUFBRSxJQUFJO3dCQUMxRCx5REFBeUQsRUFBRSxJQUFJO3FCQUNoRTtvQkFDRCxjQUFjLEVBQUU7d0JBQ2Qsa0JBQWtCLEVBQUUsa0JBQWtCO3FCQUN2QztpQkFDRjthQUNGO1NBQ0YsQ0FBQyxDQUFBO0lBQ04sQ0FBQztDQUNGO0FBOUxELGtDQThMQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCAqIGFzIGNkayBmcm9tICdAYXdzLWNkay9jb3JlJztcbmltcG9ydCBsYW1iZGEgPSByZXF1aXJlKCdAYXdzLWNkay9hd3MtbGFtYmRhJyk7XG5pbXBvcnQgZGVzdGluYXRpb25zID0gcmVxdWlyZSgnQGF3cy1jZGsvYXdzLWxhbWJkYS1kZXN0aW5hdGlvbnMnKTtcbmltcG9ydCBldmVudHMgPSByZXF1aXJlKCdAYXdzLWNkay9hd3MtZXZlbnRzJyk7XG5pbXBvcnQgZXZlbnRzX3RhcmdldHMgPSByZXF1aXJlKCdAYXdzLWNkay9hd3MtZXZlbnRzLXRhcmdldHMnKTtcbmltcG9ydCBhcGlndyA9IHJlcXVpcmUoJ0Bhd3MtY2RrL2F3cy1hcGlnYXRld2F5Jyk7XG5pbXBvcnQgc25zID0gcmVxdWlyZSgnQGF3cy1jZGsvYXdzLXNucycpO1xuaW1wb3J0IHNuc19zdWIgPSByZXF1aXJlKCdAYXdzLWNkay9hd3Mtc25zLXN1YnNjcmlwdGlvbnMnKTtcbmltcG9ydCBpYW0gPSByZXF1aXJlKCdAYXdzLWNkay9hd3MtaWFtJyk7XG5pbXBvcnQgKiBhcyBzcXMgZnJvbSBcIkBhd3MtY2RrL2F3cy1zcXNcIjtcbmltcG9ydCB7IENvZGUsIEZ1bmN0aW9uLCBSdW50aW1lIH0gZnJvbSBcIkBhd3MtY2RrL2F3cy1sYW1iZGFcIjtcbmltcG9ydCAqIGFzIGNsb3Vkd2F0Y2ggZnJvbSAnQGF3cy1jZGsvYXdzLWNsb3Vkd2F0Y2gnO1xuXG5cbmV4cG9ydCBjbGFzcyBMYW1iZGFTdGFjayBleHRlbmRzIGNkay5TdGFjayB7XG4gIGNvbnN0cnVjdG9yKHNjb3BlOiBjZGsuQ29uc3RydWN0LCBpZDogc3RyaW5nLCBwcm9wcz86IGNkay5TdGFja1Byb3BzKSB7XG4gICAgc3VwZXIoc2NvcGUsIGlkLCBwcm9wcyk7XG5cbiAgICBcbiAgICBjb25zdCBidXMgPSBuZXcgZXZlbnRzLkV2ZW50QnVzKHRoaXMsICdEZXN0aW5lZEV2ZW50QnVzJywge1xuICAgICAgZXZlbnRCdXNOYW1lOiAndGhlLWRlc3RpbmVkLWxhbWJkYSdcbiAgICB9KVxuXG4gIFxuICAgIGNvbnN0IHRvcGljID0gbmV3IHNucy5Ub3BpYyh0aGlzLCAndGhlRGVzdGluZWRMYW1iZGFUb3BpYycsXG4gICAge1xuICAgICAgZGlzcGxheU5hbWU6IFwiVGhlIERlc3RpbmVkIExhbWJkYSBDREsgUGF0dGVybiBUb3BpY1wiXG4gICAgfSk7XG5cbiAgICBjb25zdCBkZXN0aW5lZExhbWJkYSA9IG5ldyBsYW1iZGEuRnVuY3Rpb24odGhpcywgJ2Rlc3RpbmVkTGFtYmRhJywge1xuICAgICAgcnVudGltZTogbGFtYmRhLlJ1bnRpbWUuTk9ERUpTXzEyX1gsXG4gICAgICBjb2RlOiBsYW1iZGEuQ29kZS5mcm9tQXNzZXQoJ2xhbWJkYS1mbnMnKSxcbiAgICAgIGhhbmRsZXI6ICdkZXN0aW5lZExhbWJkYS5oYW5kbGVyJyxcbiAgICAgIHJldHJ5QXR0ZW1wdHM6IDAsXG4gICAgICBvblN1Y2Nlc3M6IG5ldyBkZXN0aW5hdGlvbnMuRXZlbnRCcmlkZ2VEZXN0aW5hdGlvbihidXMpLFxuICAgICAgb25GYWlsdXJlOiBuZXcgZGVzdGluYXRpb25zLkV2ZW50QnJpZGdlRGVzdGluYXRpb24oYnVzKVxuICAgIH0pO1xuXG4gICAgdG9waWMuYWRkU3Vic2NyaXB0aW9uKG5ldyBzbnNfc3ViLkxhbWJkYVN1YnNjcmlwdGlvbihkZXN0aW5lZExhbWJkYSkpXG5cbiAgICBjb25zdCBzdWNjZXNzTGFtYmRhID0gbmV3IGxhbWJkYS5GdW5jdGlvbih0aGlzLCAnU3VjY2Vzc0xhbWJkYUhhbmRsZXInLCB7XG4gICAgICBydW50aW1lOiBsYW1iZGEuUnVudGltZS5OT0RFSlNfMTJfWCxcbiAgICAgIGNvZGU6IGxhbWJkYS5Db2RlLmZyb21Bc3NldCgnbGFtYmRhLWZucycpLFxuICAgICAgaGFuZGxlcjogJ3N1Y2Nlc3MuaGFuZGxlcicsXG4gICAgICB0aW1lb3V0OiBjZGsuRHVyYXRpb24uc2Vjb25kcygzKVxuICAgIH0pO1xuXG4gICBcbiAgICBjb25zdCBzdWNjZXNzUnVsZSA9IG5ldyBldmVudHMuUnVsZSh0aGlzLCAnc3VjY2Vzc1J1bGUnLCB7XG4gICAgICBldmVudEJ1czogYnVzLFxuICAgICAgZGVzY3JpcHRpb246ICdhbGwgc3VjY2VzcyBldmVudHMgYXJlIGNhdWdodCBoZXJlIGFuZCBsb2dnZWQgY2VudHJhbGx5JyxcbiAgICAgIGV2ZW50UGF0dGVybjpcbiAgICAgIHtcbiAgICAgICAgXCJkZXRhaWxcIjoge1xuICAgICAgICAgIFwicmVxdWVzdENvbnRleHRcIjoge1xuICAgICAgICAgICAgXCJjb25kaXRpb25cIjogW1wiU3VjY2Vzc1wiXVxuICAgICAgICAgIH0sXG4gICAgICAgICAgXCJyZXNwb25zZVBheWxvYWRcIjoge1xuICAgICAgICAgICAgXCJzb3VyY2VcIjogW1wiY2RrcGF0dGVybnMudGhlLWRlc3RpbmVkLWxhbWJkYVwiXSxcbiAgICAgICAgICAgIFwiYWN0aW9uXCI6IFtcIm1lc3NhZ2VcIl1cbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9KTtcblxuICAgIHN1Y2Nlc3NSdWxlLmFkZFRhcmdldChuZXcgZXZlbnRzX3RhcmdldHMuTGFtYmRhRnVuY3Rpb24oc3VjY2Vzc0xhbWJkYSkpO1xuXG4gICAgY29uc3QgbXlEZWFkTGV0dGVyUXVldWUgPSBuZXcgc3FzLlF1ZXVlKHRoaXMsICdRdWV1ZScpO1xuICBcbiAgICBjb25zdCBmYWlsdXJlTGFtYmRhID0gbmV3IGxhbWJkYS5GdW5jdGlvbih0aGlzLCAnRmFpbHVyZUxhbWJkYUhhbmRsZXInLCB7XG4gICAgICBydW50aW1lOiBsYW1iZGEuUnVudGltZS5OT0RFSlNfMTJfWCxcbiAgICAgIGNvZGU6IGxhbWJkYS5Db2RlLmZyb21Bc3NldCgnbGFtYmRhLWZucycpLFxuICAgICAgaGFuZGxlcjogJ2ZhaWx1cmUuaGFuZGxlcicsXG4gICAgICB0aW1lb3V0OiBjZGsuRHVyYXRpb24uc2Vjb25kcygzKVxuICAgIH0pO1xuXG4gICAgY29uc3QgYWxhcm0gPSBuZXcgY2xvdWR3YXRjaC5BbGFybSh0aGlzLCdBbGFybScse1xuICAgICAgbWV0cmljOiBteURlYWRMZXR0ZXJRdWV1ZS5tZXRyaWNBcHByb3hpbWF0ZU51bWJlck9mTWVzc2FnZXNWaXNpYmxlKCksXG4gICAgICB0aHJlc2hvbGQ6IDEsXG4gICAgICBldmFsdWF0aW9uUGVyaW9kczogMVxuICAgIH0pXG5cbiAgIGNvbnN0IGZhaWx1cmVSdWxlID0gbmV3IGV2ZW50cy5SdWxlKHRoaXMsICdmYWlsdXJlUnVsZScsIHtcbiAgICAgIGV2ZW50QnVzOiBidXMsXG4gICAgICBkZXNjcmlwdGlvbjogJ2FsbCBmYWlsdXJlIGV2ZW50cyBhcmUgY2F1Z2h0IGhlcmUgYW5kIGxvZ2dlZCBjZW50cmFsbHknLFxuICAgICAgZXZlbnRQYXR0ZXJuOlxuICAgICAge1xuICAgICAgICBcImRldGFpbFwiOiB7XG4gICAgICAgICAgXCJyZXNwb25zZVBheWxvYWRcIjoge1xuICAgICAgICAgICAgXCJlcnJvclR5cGVcIjogW1wiRXJyb3JcIl1cbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9KTtcblxuICAgIGNvbnN0IGZuID0gbmV3IEZ1bmN0aW9uKHRoaXMsICdNeUZ1bicse1xuICAgICAgcnVudGltZTogUnVudGltZS5OT0RFSlNfMTJfWCxcbiAgICAgIGhhbmRsZXI6ICdpbmRleC5oYW5kbGVyJyxcbiAgICAgIGNvZGU6IGxhbWJkYS5Db2RlLmZyb21JbmxpbmUoJ2V4cG9ydC5oYW5kbGVyPSR7aGFuZGxlcn0pJylcbiAgICB9KVxuXG4gICAgZmFpbHVyZVJ1bGUuYWRkVGFyZ2V0KG5ldyBldmVudHNfdGFyZ2V0cy5MYW1iZGFGdW5jdGlvbihmYWlsdXJlTGFtYmRhKSk7XG4gICAgZmFpbHVyZVJ1bGUuYWRkVGFyZ2V0KG5ldyBldmVudHNfdGFyZ2V0cy5MYW1iZGFGdW5jdGlvbihmbix7XG4gICAgICBkZWFkTGV0dGVyUXVldWU6IG15RGVhZExldHRlclF1ZXVlXG4gICAgfSkpO1xuXG4gICAgbGV0IGdhdGV3YXkgPSBuZXcgYXBpZ3cuUmVzdEFwaSh0aGlzLCAndGhlRGVzdGluZWRMYW1iZGFBUEknLCB7XG4gICAgICBkZXBsb3lPcHRpb25zOiB7XG4gICAgICAgIG1ldHJpY3NFbmFibGVkOiB0cnVlLFxuICAgICAgICBsb2dnaW5nTGV2ZWw6IGFwaWd3Lk1ldGhvZExvZ2dpbmdMZXZlbC5JTkZPLFxuICAgICAgICBkYXRhVHJhY2VFbmFibGVkOiB0cnVlLFxuICAgICAgICBzdGFnZU5hbWU6ICdwcm9kJ1xuICAgICAgfVxuICAgIH0pO1xuXG4gIFxuICAgbGV0IGFwaWd3U25zUm9sZSA9IG5ldyBpYW0uUm9sZSh0aGlzLCAnQXBpR2F0ZXdheVNuc1JvbGUnLCB7XG4gICAgICBhc3N1bWVkQnk6IG5ldyBpYW0uU2VydmljZVByaW5jaXBhbCgnYXBpZ2F0ZXdheS5hbWF6b25hd3MuY29tJylcbiAgICB9KTtcbiAgICB0b3BpYy5ncmFudFB1Ymxpc2goYXBpZ3dTbnNSb2xlKTtcblxuIFxuICAgIGNvbnN0IHJlc3BvbnNlTW9kZWwgPSBnYXRld2F5LmFkZE1vZGVsKCdSZXNwb25zZU1vZGVsJywge1xuICAgICAgY29udGVudFR5cGU6ICdhcHBsaWNhdGlvbi9qc29uJyxcbiAgICAgIG1vZGVsTmFtZTogJ1Jlc3BvbnNlTW9kZWwnLFxuICAgICAgc2NoZW1hOiB7ICdzY2hlbWEnOiBhcGlndy5Kc29uU2NoZW1hVmVyc2lvbi5EUkFGVDQsICd0aXRsZSc6ICdwb2xsUmVzcG9uc2UnLCAndHlwZSc6IGFwaWd3Lkpzb25TY2hlbWFUeXBlLk9CSkVDVCwgJ3Byb3BlcnRpZXMnOiB7ICdtZXNzYWdlJzogeyAndHlwZSc6IGFwaWd3Lkpzb25TY2hlbWFUeXBlLlNUUklORyB9IH0gfVxuICAgIH0pO1xuICAgIFxuICBcbiAgICBjb25zdCBlcnJvclJlc3BvbnNlTW9kZWwgPSBnYXRld2F5LmFkZE1vZGVsKCdFcnJvclJlc3BvbnNlTW9kZWwnLCB7XG4gICAgICBjb250ZW50VHlwZTogJ2FwcGxpY2F0aW9uL2pzb24nLFxuICAgICAgbW9kZWxOYW1lOiAnRXJyb3JSZXNwb25zZU1vZGVsJyxcbiAgICAgIHNjaGVtYTogeyAnc2NoZW1hJzogYXBpZ3cuSnNvblNjaGVtYVZlcnNpb24uRFJBRlQ0LCAndGl0bGUnOiAnZXJyb3JSZXNwb25zZScsICd0eXBlJzogYXBpZ3cuSnNvblNjaGVtYVR5cGUuT0JKRUNULCAncHJvcGVydGllcyc6IHsgJ3N0YXRlJzogeyAndHlwZSc6IGFwaWd3Lkpzb25TY2hlbWFUeXBlLlNUUklORyB9LCAnbWVzc2FnZSc6IHsgJ3R5cGUnOiBhcGlndy5Kc29uU2NoZW1hVHlwZS5TVFJJTkcgfSB9IH1cbiAgICB9KTtcblxuICBcbiAgICBnYXRld2F5LnJvb3QuYWRkUmVzb3VyY2UoJ1NlbmRFdmVudCcpXG4gICAgICAuYWRkTWV0aG9kKCdHRVQnLCBuZXcgYXBpZ3cuSW50ZWdyYXRpb24oe1xuICAgICAgICB0eXBlOiBhcGlndy5JbnRlZ3JhdGlvblR5cGUuQVdTLCAvL25hdGl2ZSBhd3MgaW50ZWdyYXRpb25cbiAgICAgICAgaW50ZWdyYXRpb25IdHRwTWV0aG9kOiBcIlBPU1RcIixcbiAgICAgICAgdXJpOiAnYXJuOmF3czphcGlnYXRld2F5OnVzLWVhc3QtMTpzbnM6cGF0aC8vJywgLy8gVGhpcyBpcyBob3cgd2Ugc2V0dXAgYW4gU05TIFRvcGljIHB1Ymxpc2ggb3BlcmF0aW9uLlxuICAgICAgICBvcHRpb25zOiB7XG4gICAgICAgICAgY3JlZGVudGlhbHNSb2xlOiBhcGlnd1Nuc1JvbGUsXG4gICAgICAgICAgcmVxdWVzdFBhcmFtZXRlcnM6IHtcbiAgICAgICAgICAgICdpbnRlZ3JhdGlvbi5yZXF1ZXN0LmhlYWRlci5Db250ZW50LVR5cGUnOiBcIidhcHBsaWNhdGlvbi94LXd3dy1mb3JtLXVybGVuY29kZWQnXCIgLy8gVGVsbCBhcGkgZ3cgdG8gc2VuZCBvdXIgcGF5bG9hZCBhcyBxdWVyeSBwYXJhbXNcbiAgICAgICAgICB9LFxuICAgICAgICAgIHJlcXVlc3RUZW1wbGF0ZXM6IHtcbiAgICAgIFxuICAgICAgICAgICAgJ2FwcGxpY2F0aW9uL2pzb24nOiBcIkFjdGlvbj1QdWJsaXNoJlwiK1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgXCJUYXJnZXRBcm49JHV0aWwudXJsRW5jb2RlKCdcIit0b3BpYy50b3BpY0FybitcIicpJlwiK1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgXCJNZXNzYWdlPXBsZWFzZSAkaW5wdXQucGFyYW1zKCkucXVlcnlzdHJpbmcuZ2V0KCdtb2RlJykmXCIrXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICBcIlZlcnNpb249MjAxMC0wMy0zMVwiXG4gICAgICAgIH0sXG4gICAgICAgIHBhc3N0aHJvdWdoQmVoYXZpb3I6IGFwaWd3LlBhc3N0aHJvdWdoQmVoYXZpb3IuTkVWRVIsXG4gICAgICAgIGludGVncmF0aW9uUmVzcG9uc2VzOiBbXG4gICAgICAgICAge1xuICAgICAgICAgICAgc3RhdHVzQ29kZTogXCIyMDBcIixcbiAgICAgICAgICAgIHJlc3BvbnNlVGVtcGxhdGVzOiB7XG4gICAgICAgICAgICAgICdhcHBsaWNhdGlvbi9qc29uJzogSlNPTi5zdHJpbmdpZnkoeyBtZXNzYWdlOiAnTWVzc2FnZSBhZGRlZCB0byBTTlMgdG9waWMnfSlcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9LFxuICAgICAgICAgIHtcbiAgICAgICAgICAgIHNlbGVjdGlvblBhdHRlcm46ICdeXFxbRXJyb3JcXF0uKicsXG4gICAgICAgICAgICBzdGF0dXNDb2RlOiBcIjQwMFwiLFxuICAgICAgICAgICAgcmVzcG9uc2VUZW1wbGF0ZXM6IHtcbiAgICAgICAgICAgICAgICAnYXBwbGljYXRpb24vanNvbic6IEpTT04uc3RyaW5naWZ5KHsgc3RhdGU6ICdlcnJvcicsIG1lc3NhZ2U6IFwiJHV0aWwuZXNjYXBlSmF2YVNjcmlwdCgkaW5wdXQucGF0aCgnJC5lcnJvck1lc3NhZ2UnKSlcIiB9KVxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIHJlc3BvbnNlUGFyYW1ldGVyczoge1xuICAgICAgICAgICAgICAgICdtZXRob2QucmVzcG9uc2UuaGVhZGVyLkNvbnRlbnQtVHlwZSc6IFwiJ2FwcGxpY2F0aW9uL2pzb24nXCIsXG4gICAgICAgICAgICAgICAgJ21ldGhvZC5yZXNwb25zZS5oZWFkZXIuQWNjZXNzLUNvbnRyb2wtQWxsb3ctT3JpZ2luJzogXCInKidcIixcbiAgICAgICAgICAgICAgICAnbWV0aG9kLnJlc3BvbnNlLmhlYWRlci5BY2Nlc3MtQ29udHJvbC1BbGxvdy1DcmVkZW50aWFscyc6IFwiJ3RydWUnXCJcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9XG4gICAgICAgIF1cbiAgICAgICAgfVxuICAgICAgfSksXG4gICAgICB7XG4gICAgICAgIG1ldGhvZFJlc3BvbnNlczogWyBcbiAgICAgICAgICB7XG4gICAgICAgICAgXG4gICAgICAgICAgICBzdGF0dXNDb2RlOiAnMjAwJyxcbiAgICAgICAgICAgIHJlc3BvbnNlUGFyYW1ldGVyczoge1xuICAgICAgICAgICAgICAnbWV0aG9kLnJlc3BvbnNlLmhlYWRlci5Db250ZW50LVR5cGUnOiB0cnVlLFxuICAgICAgICAgICAgICAnbWV0aG9kLnJlc3BvbnNlLmhlYWRlci5BY2Nlc3MtQ29udHJvbC1BbGxvdy1PcmlnaW4nOiB0cnVlLFxuICAgICAgICAgICAgICAnbWV0aG9kLnJlc3BvbnNlLmhlYWRlci5BY2Nlc3MtQ29udHJvbC1BbGxvdy1DcmVkZW50aWFscyc6IHRydWVcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgIHJlc3BvbnNlTW9kZWxzOiB7XG4gICAgICAgICAgICAgICdhcHBsaWNhdGlvbi9qc29uJzogcmVzcG9uc2VNb2RlbFxuICAgICAgICAgICAgfVxuICAgICAgICAgIH0sXG4gICAgICAgICAge1xuICAgICAgICAgICAgc3RhdHVzQ29kZTogJzQwMCcsXG4gICAgICAgICAgICByZXNwb25zZVBhcmFtZXRlcnM6IHtcbiAgICAgICAgICAgICAgJ21ldGhvZC5yZXNwb25zZS5oZWFkZXIuQ29udGVudC1UeXBlJzogdHJ1ZSxcbiAgICAgICAgICAgICAgJ21ldGhvZC5yZXNwb25zZS5oZWFkZXIuQWNjZXNzLUNvbnRyb2wtQWxsb3ctT3JpZ2luJzogdHJ1ZSxcbiAgICAgICAgICAgICAgJ21ldGhvZC5yZXNwb25zZS5oZWFkZXIuQWNjZXNzLUNvbnRyb2wtQWxsb3ctQ3JlZGVudGlhbHMnOiB0cnVlXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgcmVzcG9uc2VNb2RlbHM6IHtcbiAgICAgICAgICAgICAgJ2FwcGxpY2F0aW9uL2pzb24nOiBlcnJvclJlc3BvbnNlTW9kZWxcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9XG4gICAgICAgIF1cbiAgICAgIH0pXG4gIH1cbn1cbiJdfQ==
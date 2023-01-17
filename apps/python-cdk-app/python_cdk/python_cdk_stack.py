from aws_cdk import (
    Duration,
    Stack,
    aws_sqs as sqs,
)
import aws_cdk as cdk
from constructs import Construct

class PythonCdkStack(Stack):

    def __init__(self, scope: Construct, construct_id: str, **kwargs) -> None:
        super().__init__(scope, construct_id, **kwargs)

        # The code that defines your stack goes here

        # example resource
        queue = sqs.Queue(
            self, "PythonCdkQueue",
            visibility_timeout=Duration.seconds(300),
            removal_policy=cdk.RemovalPolicy.DESTROY
        )

        cdk.CfnOutput(self, "QueueStackOutput", value=queue.queue_url, export_name="QueueUrl")

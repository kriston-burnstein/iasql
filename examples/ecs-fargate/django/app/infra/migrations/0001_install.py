# Generated by Django 3.2.12 on 2022-03-30 10:18

from django.db import migrations


class Migration(migrations.Migration):

    initial = True

    dependencies = [
    ]

    operations = [
        migrations.RunSQL(
            """
            SELECT * FROM iasql_install(
                'aws_ecs_simplified', 'aws_codebuild'
            );
            """,
            """
            SELECT * FROM iasql_uninstall(
                'aws_ecs_simplified', 'aws_codebuild'
            );
            """
        )
    ]

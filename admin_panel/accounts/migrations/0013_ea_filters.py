from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('accounts', '0012_menu_names'),
    ]

    operations = [
        migrations.AddField(
            model_name='eaconnection',
            name='filters',
            field=models.JSONField(blank=True, default=dict, help_text="The customer's auto-trading settings from the terminal: models, symbols, grade, daily bias, sessions, direction, days, trades a day and risk"),
        ),
    ]

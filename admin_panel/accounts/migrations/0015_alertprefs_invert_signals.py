from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("accounts", "0014_support_contact"),
    ]

    operations = [
        migrations.AddField(
            model_name="alertprefs",
            name="invert_signals",
            field=models.BooleanField(default=False, help_text="Send every model signal flipped: a buy becomes a sell (stop and targets mirrored)", verbose_name="Opposite direction"),
        ),
    ]

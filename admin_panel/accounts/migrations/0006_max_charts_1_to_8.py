from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("accounts", "0005_whatsapp_alerts"),
    ]

    operations = [
        migrations.AlterField(
            model_name="plan",
            name="max_charts",
            field=models.PositiveSmallIntegerField(
                choices=[(1, "1"), (2, "2"), (3, "3"), (4, "4"), (5, "5"), (6, "6"), (7, "7"), (8, "8")],
                default=4, verbose_name="Charts per layout"),
        ),
    ]

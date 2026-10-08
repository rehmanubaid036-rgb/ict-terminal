from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('accounts', '0013_ea_filters'),
    ]

    operations = [
        migrations.AddField(
            model_name='sitesettings',
            name='support_email',
            field=models.EmailField(blank=True, help_text="Shown to customers. Empty = the server's SUPPORT_EMAIL setting.", max_length=254, verbose_name='Support email'),
        ),
        migrations.AddField(
            model_name='sitesettings',
            name='support_whatsapp',
            field=models.CharField(blank=True, help_text="Number with country code, e.g. 923001234567. Empty = the server's SUPPORT_WHATSAPP setting.", max_length=30, verbose_name='Support WhatsApp'),
        ),
    ]

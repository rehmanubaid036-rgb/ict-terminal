from django.contrib import admin
from django.urls import include, path
from django.views.generic import RedirectView

from accounts.stats import stats_view

admin.site.site_header = "ICT Terminal Admin"
admin.site.site_title = "ICT Terminal Admin"

urlpatterns = [
    path("", RedirectView.as_view(url="/admin/", permanent=False)),
    path("admin/stats/", admin.site.admin_view(stats_view), name="ict_stats"),
    path("admin/", admin.site.urls),
    path("api/v1/", include("accounts.urls")),
]

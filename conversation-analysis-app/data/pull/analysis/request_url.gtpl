{{- $baseUrl := .integration.configuration.apiBaseUrl -}}
{{$baseUrl}}/api/analysis?customerId={{urlquery .customer.id}}

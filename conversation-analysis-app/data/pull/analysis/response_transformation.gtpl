{
  "customerId": "{{ .rawData.customerId }}",
  "analyses": [
    {{- $first := true -}}
    {{- range .rawData.analyses -}}
    {{- if not $first }},{{ end -}}
    {{- $first = false }}
    {
      "conversationId": "{{ .conversationId }}",
      "analyzedAt": "{{ .analyzedAt }}",
      {{- if .sentiment }}
      "sentiment": {
        "score": {{ .sentiment.score }},
        "label": "{{ .sentiment.label }}",
        "confidence": {{ .sentiment.confidence }},
        "trajectory": "{{ .sentiment.trajectory }}",
        "keyIndicators": []
      },
      {{- else }}
      "sentiment": null,
      {{- end }}
      {{- if .intent }}
      "intent": {
        "primaryIntent": "{{ .intent.primary_intent }}",
        "intentConfidence": {{ if .intent.confidence }}{{ .intent.confidence }}{{ else }}0.0{{ end }},
        "urgency": "{{ .intent.urgency }}",
        "detectedTopics": {{ toJson .intent.detected_topics }}
      },
      {{- else }}
      "intent": null,
      {{- end }}
      "topicsApplied": {{ toJson .topicsApplied }},
      "summary": {{ toJson .summary }}
    }
    {{- end }}
  ]
}

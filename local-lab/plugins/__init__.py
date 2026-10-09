"""
local-lab/plugins — بنية الإضافات (المحطة الخامسة).
====================================================
أي ملف .py في plugins/checks/ يعرّف:
  PLUGIN = {"code","name","owasp","severity","family"}  (+require اختياري)
  def run(session, base, mode) -> (sub_status, status, verdict, note, evidence)
وهو نفس عقد الفحص. التحميل اختياري وصريح (لا شيء تلقائي).
"""

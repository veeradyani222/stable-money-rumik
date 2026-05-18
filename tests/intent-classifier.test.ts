import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  classifyStableIntentWithAI,
  resetIntentClassificationCacheForTests,
  resolveStableTurnRoute,
} from '../lib/agent/intent-classifier';
import { routeStableIntent, routeStableTurn, traceStableTurnRoute } from '../lib/agent/stable-policy';

const stablePolicySource = fs.readFileSync(path.join(process.cwd(), 'lib', 'agent', 'stable-policy.ts'), 'utf8');

test('stable policy keeps deterministic keywords in one obvious per-intent transcript table', () => {
  assert.notEqual(stablePolicySource.indexOf('const DETERMINISTIC_INTENT_KEYWORDS'), -1);
  assert.equal(stablePolicySource.includes('SCRIPT_INTENT_KEYWORDS'), false);
  assert.equal(stablePolicySource.includes('LATIN_INTENT_KEYWORDS'), false);
});

test('routeStableIntent resolves common Hinglish turns without AI', () => {
  assert.deepEqual(routeStableIntent('payment debit ho gaya but FD nahi bana'), {
    intent: 'payment.failed',
    authTier: 'Tier B',
    tools: ['verify_read_access', 'get_payment_reconciliation_status'],
  });
  assert.deepEqual(routeStableIntent('KYC pending hai kya?'), {
    intent: 'kyc.status',
    authTier: 'Tier B',
    tools: ['verify_read_access', 'get_kyc_status'],
  });
  assert.deepEqual(routeStableIntent('thank you, call end kar do'), {
    intent: 'conversation.goodbye',
    authTier: 'Tier A',
    tools: [],
  });
  assert.equal(routeStableIntent('FD rates compare kar do').intent, 'fd.rates.compare');
  assert.equal(routeStableIntent('meri FDs list dikhao').intent, 'fd.summary');
  assert.equal(routeStableIntent('payment failed hai').intent, 'payment.failed');
});

test('routeStableIntent resolves every deterministic intent across Latin, Devanagari, Gurmukhi, and Arabic-script transcripts', () => {
  const cases: Array<{ transcript: string; intent: string; label: string }> = [
    { label: 'payment.failed latin', transcript: 'payment failed and money debited', intent: 'payment.failed' },
    { label: 'payment.failed devanagari', transcript: 'पेमेंट फेल हो गया और पैसा कट गया', intent: 'payment.failed' },
    { label: 'payment.failed gurmukhi', transcript: 'ਪੇਮੈਂਟ ਫੇਲ ਹੋ ਗਈ ਤੇ ਪੈਸੇ ਕੱਟ ਗਏ', intent: 'payment.failed' },
    { label: 'payment.failed arabic', transcript: 'پیمنٹ فیل ہو گئی اور پیسے کٹ گئے', intent: 'payment.failed' },
    { label: 'fd.book.status latin', transcript: 'meri FD booking status batao', intent: 'fd.book.status' },
    { label: 'fd.book.status devanagari', transcript: 'मेरी एफडी बुकिंग का स्टेटस बताओ', intent: 'fd.book.status' },
    { label: 'fd.book.status gurmukhi', transcript: 'ਮੇਰੀ ਐਫਡੀ ਬੁਕਿੰਗ ਦਾ ਸਟੇਟਸ ਦੱਸੋ', intent: 'fd.book.status' },
    { label: 'fd.book.status arabic', transcript: 'میری ایف ڈی بکنگ کا سٹیٹس بتاؤ', intent: 'fd.book.status' },
    { label: 'fd.withdraw.premature latin', transcript: 'I want to break my FD early', intent: 'fd.withdraw.premature' },
    { label: 'fd.withdraw.premature devanagari', transcript: 'मुझे मेरी एफडी तोड़नी है', intent: 'fd.withdraw.premature' },
    { label: 'fd.withdraw.premature gurmukhi', transcript: 'ਮੈਨੂੰ ਮੇਰੀ ਐਫਡੀ ਤੋੜਨੀ ਹੈ', intent: 'fd.withdraw.premature' },
    { label: 'fd.withdraw.premature arabic', transcript: 'مجھے میری ایف ڈی توڑنی ہے', intent: 'fd.withdraw.premature' },
    { label: 'kyc.status latin', transcript: 'KYC status pending hai kya', intent: 'kyc.status' },
    { label: 'kyc.status devanagari', transcript: 'मेरी केवाईसी का स्टेटस क्या है', intent: 'kyc.status' },
    { label: 'kyc.status gurmukhi', transcript: 'ਮੇਰੀ ਕੇਵਾਈਸੀ ਦਾ ਸਟੇਟਸ ਕੀ ਹੈ', intent: 'kyc.status' },
    { label: 'kyc.status arabic', transcript: 'میری کے وائی سی کا سٹیٹس کیا ہے', intent: 'kyc.status' },
    { label: 'kyc.explainer latin', transcript: 'what is KYC', intent: 'kyc.explainer' },
    { label: 'kyc.explainer devanagari', transcript: 'केवाईसी क्या है', intent: 'kyc.explainer' },
    { label: 'kyc.explainer gurmukhi', transcript: 'ਕੇਵਾਈਸੀ ਕੀ ਹੈ', intent: 'kyc.explainer' },
    { label: 'kyc.explainer arabic', transcript: 'کے وائی سی کیا ہے', intent: 'kyc.explainer' },
    { label: 'fd.rates.compare latin', transcript: 'FD interest rate compare karo', intent: 'fd.rates.compare' },
    { label: 'fd.rates.compare devanagari', transcript: 'एफडी का ब्याज दर बताओ', intent: 'fd.rates.compare' },
    { label: 'fd.rates.compare gurmukhi', transcript: 'ਐਫਡੀ ਦਾ ਵਿਆਜ ਦਰ ਦੱਸੋ', intent: 'fd.rates.compare' },
    { label: 'fd.rates.compare arabic', transcript: 'ایف ڈی کا انٹرسٹ ریٹ بتاؤ', intent: 'fd.rates.compare' },
    { label: 'maturity.payout.delay latin', transcript: 'maturity payout nahi aaya', intent: 'maturity.payout.delay' },
    { label: 'maturity.payout.delay devanagari', transcript: 'मैच्योरिटी पेआउट नहीं आया', intent: 'maturity.payout.delay' },
    { label: 'maturity.payout.delay gurmukhi', transcript: 'ਮੈਚੋਰਿਟੀ ਪੇਆਉਟ ਨਹੀਂ ਆਇਆ', intent: 'maturity.payout.delay' },
    { label: 'maturity.payout.delay arabic', transcript: 'میچورٹی پی آؤٹ نہیں آیا', intent: 'maturity.payout.delay' },
    { label: 'app.real.check latin', transcript: 'Stable Money real safe hai kya', intent: 'app.real.check' },
    { label: 'app.real.check devanagari', transcript: 'स्टेबल मनी सेफ है क्या', intent: 'app.real.check' },
    { label: 'app.real.check gurmukhi', transcript: 'ਸਟੇਬਲ ਮਨੀ ਸੇਫ ਹੈ ਕਿ ਨਹੀਂ', intent: 'app.real.check' },
    { label: 'app.real.check arabic', transcript: 'کیا سٹیبل منی سیف ہے', intent: 'app.real.check' },
    { label: 'ticket.status latin', transcript: 'ticket status batao', intent: 'ticket.status' },
    { label: 'ticket.status devanagari', transcript: 'मेरे टिकट का स्टेटस बताओ', intent: 'ticket.status' },
    { label: 'ticket.status gurmukhi', transcript: 'ਮੇਰੀ ਟਿਕਟ ਦਾ ਸਟੇਟਸ ਦੱਸੋ', intent: 'ticket.status' },
    { label: 'ticket.status arabic', transcript: 'میرے ٹکٹ کا سٹیٹس بتاؤ', intent: 'ticket.status' },
    { label: 'grievance.escalate latin', transcript: 'complaint raise karni hai', intent: 'grievance.escalate' },
    { label: 'grievance.escalate devanagari', transcript: 'मुझे शिकायत दर्ज करनी है', intent: 'grievance.escalate' },
    { label: 'grievance.escalate gurmukhi', transcript: 'ਮੈਨੂੰ ਸ਼ਿਕਾਇਤ ਦਰਜ ਕਰਨੀ ਹੈ', intent: 'grievance.escalate' },
    { label: 'grievance.escalate arabic', transcript: 'مجھے شکایت درج کرنی ہے', intent: 'grievance.escalate' },
    { label: 'support.contact latin', transcript: 'support number do', intent: 'support.contact' },
    { label: 'support.contact devanagari', transcript: 'सपोर्ट का नंबर दो', intent: 'support.contact' },
    { label: 'support.contact gurmukhi', transcript: 'ਸਪੋਰਟ ਨੰਬਰ ਦੱਸੋ', intent: 'support.contact' },
    { label: 'support.contact arabic', transcript: 'سپورٹ نمبر دو', intent: 'support.contact' },
    { label: 'payment.summary latin', transcript: 'mere payments ke bare mein batao', intent: 'payment.summary' },
    { label: 'payment.summary devanagari', transcript: 'मेरे पेमेंट्स के बारे में बताओ', intent: 'payment.summary' },
    { label: 'payment.summary gurmukhi', transcript: 'ਮੇਰੇ ਪੇਮੈਂਟਸ ਬਾਰੇ ਦੱਸੋ', intent: 'payment.summary' },
    { label: 'payment.summary arabic', transcript: 'میرے پیمنٹس کے بارے میں بتاؤ', intent: 'payment.summary' },
    { label: 'fd.summary latin', transcript: 'meri FD ke baare mein batao', intent: 'fd.summary' },
    { label: 'fd.summary devanagari', transcript: 'मेरी एफडी के बारे में बताओ', intent: 'fd.summary' },
    { label: 'fd.summary gurmukhi', transcript: 'ਮੇਰੀ ਐਫਡੀ ਬਾਰੇ ਦੱਸੋ', intent: 'fd.summary' },
    { label: 'fd.summary arabic', transcript: 'میری ایف ڈی کے بارے میں بتاؤ', intent: 'fd.summary' },
    { label: 'account.overview latin', transcript: 'account overview batao', intent: 'account.overview' },
    { label: 'account.overview devanagari', transcript: 'मेरा अकाउंट ओवरव्यू बताओ', intent: 'account.overview' },
    { label: 'account.overview gurmukhi', transcript: 'ਮੇਰਾ ਅਕਾਊਂਟ ਓਵਰਵਿਊ ਦੱਸੋ', intent: 'account.overview' },
    { label: 'account.overview arabic', transcript: 'میرا اکاؤنٹ اوورویو بتاؤ', intent: 'account.overview' },
    { label: 'refund.status latin', transcript: 'refund status kab aayega', intent: 'refund.status' },
    { label: 'refund.status devanagari', transcript: 'मेरा रिफंड कब आएगा', intent: 'refund.status' },
    { label: 'refund.status gurmukhi', transcript: 'ਮੇਰਾ ਰਿਫੰਡ ਕਦੋਂ ਆਵੇਗਾ', intent: 'refund.status' },
    { label: 'refund.status arabic', transcript: 'میرا ریفنڈ کب آئے گا', intent: 'refund.status' },
    { label: 'secure.action.help latin', transcript: 'mobile number change karna hai', intent: 'secure.action.help' },
    { label: 'secure.action.help devanagari', transcript: 'मेरा मोबाइल नंबर बदलना है', intent: 'secure.action.help' },
    { label: 'secure.action.help gurmukhi', transcript: 'ਮੇਰਾ ਮੋਬਾਈਲ ਨੰਬਰ ਬਦਲਣਾ ਹੈ', intent: 'secure.action.help' },
    { label: 'secure.action.help arabic', transcript: 'میرا موبائل نمبر بدلنا ہے', intent: 'secure.action.help' },
    { label: 'conversation.goodbye latin', transcript: 'thank you call end kar do', intent: 'conversation.goodbye' },
    { label: 'conversation.goodbye devanagari', transcript: 'धन्यवाद कॉल बंद करो', intent: 'conversation.goodbye' },
    { label: 'conversation.goodbye gurmukhi', transcript: 'ਧੰਨਵਾਦ ਕਾਲ ਬੰਦ ਕਰੋ', intent: 'conversation.goodbye' },
    { label: 'conversation.goodbye arabic', transcript: 'شکریہ کال بند کرو', intent: 'conversation.goodbye' },
  ];

  for (const item of cases) {
    assert.equal(routeStableIntent(item.transcript).intent, item.intent, item.label);
  }
});

test('routeStableIntent matches Unicode scripts directly without transliteration', () => {
  assert.equal(routeStableIntent('मेरा KYC status क्या है?').intent, 'kyc.status');
  assert.equal(routeStableIntent('میرا پیمنٹ فیل ہو گیا؟').intent, 'payment.failed');
});

test('traceStableTurnRoute exposes Unicode-preserving normalized text and matched pattern for logs', () => {
  const hit = traceStableTurnRoute('मेरा पेमेंट फेल हो गया है।');

  assert.equal(hit.route.intent, 'payment.failed');
  assert.equal(hit.normalizedTranscript, 'मेरा पेमेंट फेल हो गया है');
  assert.equal(hit.matchSource, 'keyword');
  assert.equal(hit.matchedPattern, 'पेमेंट फेल');

  const miss = traceStableTurnRoute('पेमेंट');
  assert.equal(miss.route.intent, 'unknown');
  assert.equal(miss.normalizedTranscript, 'पेमेंट');
  assert.equal(miss.matchSource, 'unknown');
  assert.equal(miss.matchedPattern, null);
});

test('routeStableIntent resolves recorded local-script loanword variants', () => {
  const cases: Array<{ transcript: string; intent: string }> = [
    { transcript: 'अलविदा', intent: 'conversation.goodbye' },
    { transcript: 'شکریہ', intent: 'conversation.goodbye' },
    { transcript: 'পেমেন্ট ফেল', intent: 'payment.failed' },
    { transcript: 'பேமெண்ட் ஃபெயில்', intent: 'payment.failed' },
    { transcript: 'పేమెంట్ ఫెయిల్', intent: 'payment.failed' },
    { transcript: 'પેમેન્ટ ફેલ', intent: 'payment.failed' },
    { transcript: 'एफडी ब्रेक', intent: 'fd.withdraw.premature' },
    { transcript: 'ایف ڈی کلوز', intent: 'fd.withdraw.premature' },
    { transcript: 'केवाईसी क्या है', intent: 'kyc.explainer' },
    { transcript: 'કેવાયસી શું છે', intent: 'kyc.explainer' },
    { transcript: 'کے وائی سی سٹیٹس', intent: 'kyc.status' },
    { transcript: 'কেওয়াইসি স্টেটাস', intent: 'kyc.status' },
    { transcript: 'கேஒய்சி ஸ்டேட்டஸ்', intent: 'kyc.status' },
    { transcript: 'కేవైసీ స్టేటస్', intent: 'kyc.status' },
    { transcript: 'एफडी रेट', intent: 'fd.rates.compare' },
    { transcript: 'انٹرسٹ ریٹ', intent: 'fd.rates.compare' },
    { transcript: 'सेफ है', intent: 'app.real.check' },
    { transcript: 'پارٹنر بینک', intent: 'app.real.check' },
    { transcript: 'સપોર્ટ નંબર', intent: 'support.contact' },
    { transcript: 'سپورٹ نمبر', intent: 'support.contact' },
    { transcript: 'ਐਫਡੀ ਸਟੇਟਸ', intent: 'fd.book.status' },
    { transcript: 'એફડી સ્ટેટસ', intent: 'fd.book.status' },
    { transcript: 'রিফান্ড স্টেটাস', intent: 'refund.status' },
    { transcript: 'ریفنڈ سٹیٹس', intent: 'refund.status' },
    { transcript: 'मैच्योरिटी पेआउट', intent: 'maturity.payout.delay' },
    { transcript: 'पेमेंट हिस्ट्री', intent: 'payment.summary' },
    { transcript: 'పేమెంట్ హిస్టరీ', intent: 'payment.summary' },
    { transcript: 'એફડી લિસ્ટ', intent: 'fd.summary' },
    { transcript: 'ایف ڈی لسٹ', intent: 'fd.summary' },
    { transcript: 'अकाउंट स्टेटस', intent: 'account.overview' },
    { transcript: 'அக்கவுண்ட் ஸ்டேட்டஸ்', intent: 'account.overview' },
    { transcript: 'मोबाइल चेंज', intent: 'secure.action.help' },
    { transcript: 'بینک چینج', intent: 'secure.action.help' },
    { transcript: 'कम्प्लेंट', intent: 'grievance.escalate' },
    { transcript: 'ٹکٹ سٹیٹس', intent: 'ticket.status' },
  ];

  for (const item of cases) {
    assert.equal(routeStableIntent(item.transcript).intent, item.intent, item.transcript);
  }
});

test('routeStableIntent resolves native-script summary and status phrasing from voice turns', () => {
  const cases: Array<{ transcript: string; intent: string }> = [
    { transcript: 'मुझे मेरे पेमेंट्स के बारे में भी बता दो', intent: 'payment.summary' },
    { transcript: 'مجھے میرے پیمنٹس کے بارے میں بھی بتا دو', intent: 'payment.summary' },
    { transcript: 'আমার পেমেন্টস সম্পর্কে বলুন', intent: 'payment.summary' },
    { transcript: 'ਮੈਨੂੰ ਮੇਰੇ ਪੇਮੈਂਟਸ ਬਾਰੇ ਦੱਸੋ', intent: 'payment.summary' },
    { transcript: 'મારા પેમેન્ટ્સ વિશે કહો', intent: 'payment.summary' },
    { transcript: 'ನನ್ನ ಪೇಮೆಂಟ್ಸ್ ಬಗ್ಗೆ ಹೇಳಿ', intent: 'payment.summary' },
    { transcript: 'മൈ പേയ്‌മെന്റ്സ് കുറിച്ച് പറയൂ', intent: 'payment.summary' },
    { transcript: 'मुझे मेरी एफडीज़ के बारे में बताओ।', intent: 'fd.summary' },
    { transcript: 'مجھے میری ایف ڈیز کے بارے میں بتاؤ', intent: 'fd.summary' },
    { transcript: 'আমার এফডিগুলো সম্পর্কে বলুন', intent: 'fd.summary' },
    { transcript: 'ਮੇਰੀ ਐਫਡੀਜ਼ ਬਾਰੇ ਦੱਸੋ', intent: 'fd.summary' },
    { transcript: 'મારી એફડીઓ વિશે કહો', intent: 'fd.summary' },
    { transcript: 'ನನ್ನ ಎಫ್ಡಿಗಳ ಬಗ್ಗೆ ಹೇಳಿ', intent: 'fd.summary' },
    { transcript: 'என் எஃப்டிகள் பற்றி சொல்லுங்கள்', intent: 'fd.summary' },
  ];

  for (const item of cases) {
    assert.equal(routeStableIntent(item.transcript).intent, item.intent, item.transcript);
  }
});

test('routeStableIntent resolves broad native-script phrases across support tools', () => {
  const cases: Array<{ transcript: string; intent: string }> = [
    { transcript: 'मेरी एफडी बुक हुई क्या', intent: 'fd.book.status' },
    { transcript: 'میری ایف ڈی بکنگ کا اسٹیٹس بتائیں', intent: 'fd.book.status' },
    { transcript: 'मुझे एफडी तोड़नी है', intent: 'fd.withdraw.premature' },
    { transcript: 'আমার এফডি ভাঙতে চাই', intent: 'fd.withdraw.premature' },
    { transcript: 'केवाईसी अप्रूव हुआ क्या', intent: 'kyc.status' },
    { transcript: 'ਕੇਵਾਈਸੀ ਪੈਂਡਿੰਗ ਹੈ ਕਿ ਨਹੀਂ', intent: 'kyc.status' },
    { transcript: 'केवाईसी का मतलब क्या है', intent: 'kyc.explainer' },
    { transcript: 'کے وائی سی کیا ہوتا ہے', intent: 'kyc.explainer' },
    { transcript: 'एफडी का ब्याज दर बताओ', intent: 'fd.rates.compare' },
    { transcript: 'எஃப்டி வட்டி ரேட் சொல்லுங்கள்', intent: 'fd.rates.compare' },
    { transcript: 'मेच्योरिटी पेआउट नहीं आया', intent: 'maturity.payout.delay' },
    { transcript: 'મેચ્યોરિટી પેઆઉટ પેન્ડિંગ છે', intent: 'maturity.payout.delay' },
    { transcript: 'स्टेबल मनी सेफ है क्या', intent: 'app.real.check' },
    { transcript: 'স্টেবল মানি কি সেফ', intent: 'app.real.check' },
    { transcript: 'मेरे टिकट का स्टेटस क्या है', intent: 'ticket.status' },
    { transcript: 'ਮੇਰੀ ਟਿਕਟ ਦਾ ਸਟੇਟਸ ਦੱਸੋ', intent: 'ticket.status' },
    { transcript: 'मुझे शिकायत दर्ज करनी है', intent: 'grievance.escalate' },
    { transcript: 'مجھے کمپلینٹ کرنی ہے', intent: 'grievance.escalate' },
    { transcript: 'सपोर्ट का नंबर दो', intent: 'support.contact' },
    { transcript: 'সাপোর্ট নম্বর দিন', intent: 'support.contact' },
    { transcript: 'मेरा अकाउंट ओवरव्यू बताओ', intent: 'account.overview' },
    { transcript: 'ਮੇਰਾ ਅਕਾਊਂਟ ਸਟੇਟਸ ਦੱਸੋ', intent: 'account.overview' },
    { transcript: 'मेरा रिफंड कब आएगा', intent: 'refund.status' },
    { transcript: 'আমার রিফান্ড কবে আসবে', intent: 'refund.status' },
    { transcript: 'मेरा बैंक अकाउंट बदलना है', intent: 'secure.action.help' },
    { transcript: 'ਮੇਰਾ ਨੋਮਿਨੀ ਅਪਡੇਟ ਕਰਨਾ ਹੈ', intent: 'secure.action.help' },
    { transcript: 'बस इतना ही कॉल बंद करो', intent: 'conversation.goodbye' },
    { transcript: 'بس اتنا ہی کال بند کرو', intent: 'conversation.goodbye' },
    { transcript: 'नहीं धन्यवाद और कुछ नहीं', intent: 'conversation.goodbye' },
    { transcript: 'बस हो गया धन्यवाद', intent: 'conversation.goodbye' },
    { transcript: 'नको धन्यवाद अजून काही नाही', intent: 'conversation.goodbye' },
    { transcript: 'ਨਹੀਂ ਧੰਨਵਾਦ ਹੋਰ ਕੁਝ ਨਹੀਂ', intent: 'conversation.goodbye' },
    { transcript: 'نہیں شکریہ اور کچھ نہیں', intent: 'conversation.goodbye' },
    { transcript: 'আর কিছু না ধন্যবাদ', intent: 'conversation.goodbye' },
    { transcript: 'ના આભાર બીજું કંઈ નહીં', intent: 'conversation.goodbye' },
    { transcript: 'ಬೇಡ ಧನ್ಯವಾದ ಇನ್ನೇನೂ ಇಲ್ಲ', intent: 'conversation.goodbye' },
    { transcript: 'വേണ്ട നന്ദി മറ്റൊന്നുമില്ല', intent: 'conversation.goodbye' },
    { transcript: 'வேண்டாம் நன்றி வேற ஒன்றும் இல்லை', intent: 'conversation.goodbye' },
    { transcript: 'వద్దు ధన్యవాదాలు ఇంకేమీ లేదు', intent: 'conversation.goodbye' },
    { transcript: 'एफडी बुक झाली का', intent: 'fd.book.status' },
    { transcript: 'मला एफडी मोडायची आहे', intent: 'fd.withdraw.premature' },
    { transcript: 'केवायसी म्हणजे काय', intent: 'kyc.explainer' },
    { transcript: 'केवायसी स्थिती सांगा', intent: 'kyc.status' },
    { transcript: 'माझे पेमेंट्स सांगा', intent: 'payment.summary' },
    { transcript: 'माझ्या एफडी सांगा', intent: 'fd.summary' },
    { transcript: 'खाते स्थिती सांगा', intent: 'account.overview' },
    { transcript: 'تغيير الجوال', intent: 'secure.action.help' },
    { transcript: 'حالة التذكرة', intent: 'ticket.status' },
    { transcript: 'رقم الدعم', intent: 'support.contact' },
  ];

  for (const item of cases) {
    assert.equal(routeStableIntent(item.transcript).intent, item.intent, item.transcript);
  }
});

test('routeStableIntent resolves expanded cross-script phrasing for every support intent', () => {
  const cases: Array<{ transcript: string; intent: string }> = [
    { transcript: 'பணம் கழிந்தது ஆனால் எஃப்டி உருவாகவில்லை', intent: 'payment.failed' },
    { transcript: 'আমার এফডি বুক হয়েছে কি', intent: 'fd.book.status' },
    { transcript: 'મારે એફડી તોડવી છે', intent: 'fd.withdraw.premature' },
    { transcript: 'ಕೆವೈಸಿ ಎಂದರೆ ಏನು', intent: 'kyc.explainer' },
    { transcript: 'എന്റെ കെവൈസി സ്റ്റാറ്റസ് പറയൂ', intent: 'kyc.status' },
    { transcript: 'એફડી વ્યાજ દર જણાવો', intent: 'fd.rates.compare' },
    { transcript: 'மெச்சூரிட்டி பணம் வரவில்லை', intent: 'maturity.payout.delay' },
    { transcript: 'ಸ್ಟೇಬಲ್ ಮನಿ ಸುರಕ್ಷಿತವೇ', intent: 'app.real.check' },
    { transcript: 'என் டிக்கெட் நிலை சொல்லுங்கள்', intent: 'ticket.status' },
    { transcript: 'আমার অভিযোগ জানাতে চাই', intent: 'grievance.escalate' },
    { transcript: 'કસ્ટમર કેર નંબર આપો', intent: 'support.contact' },
    { transcript: 'என் பேமெண்ட்ஸ் விவரம் சொல்லுங்கள்', intent: 'payment.summary' },
    { transcript: 'ನನ್ನ ಎಫ್ಡಿ ಪಟ್ಟಿ ಹೇಳಿ', intent: 'fd.summary' },
    { transcript: 'મારું એકાઉન્ટ સ્ટેટસ કહો', intent: 'account.overview' },
    { transcript: 'నా రిఫండ్ ఎప్పుడు వస్తుంది', intent: 'refund.status' },
    { transcript: 'എന്റെ മൊബൈൽ നമ്പർ മാറ്റണം', intent: 'secure.action.help' },
    { transcript: 'కాల్ పెట్టేస్తాను ధన్యవాదాలు', intent: 'conversation.goodbye' },
  ];

  for (const item of cases) {
    assert.equal(routeStableIntent(item.transcript).intent, item.intent, item.transcript);
  }
});

test('routeStableIntent does not depend on any-ascii artifact spellings', () => {
  assert.equal(routeStableIntent('mujhe meri ephdij ke bare mem btao').intent, 'unknown');
  assert.equal(routeStableIntent('mujhe mere pememts ke bare mem bhi bta do').intent, 'unknown');
  assert.equal(routeStableIntent('mjhe myre pymnts ke bre myn bhy bt dw').intent, 'unknown');
  assert.equal(routeStableIntent('mujhe mere payments ke bare me batao').intent, 'payment.summary');
});

test('routeStableIntent resolves fixed deposit, paisa, madad, and help wording', () => {
  const cases: Array<{ transcript: string; intent: string }> = [
    { transcript: 'tell me about my fixed deposits', intent: 'fd.summary' },
    { transcript: 'fix deposit details batao', intent: 'fd.summary' },
    { transcript: 'fixed desposit status kya hai', intent: 'fd.book.status' },
    { transcript: 'fixed deposit rate compare kar do', intent: 'fd.rates.compare' },
    { transcript: 'break my fixed deposit', intent: 'fd.withdraw.premature' },
    { transcript: 'paisa atak gaya hai madad karo', intent: 'payment.failed' },
    { transcript: 'paise cut gaye help chahiye', intent: 'payment.failed' },
    { transcript: 'mera paisa wapas kab aayega', intent: 'refund.status' },
    { transcript: 'mujhe madad chahiye support se baat karni hai', intent: 'support.contact' },
    { transcript: 'help karo customer care ka number do', intent: 'support.contact' },
  ];

  for (const item of cases) {
    assert.equal(routeStableIntent(item.transcript).intent, item.intent, item.transcript);
  }
});

test('routeStableTurn preserves active intent for short verification answers', () => {
  const route = routeStableTurn('3210', [
    { role: 'user', text: 'payment debit ho gaya but FD nahi bana' },
    { role: 'model', text: 'Mobile ke last 4 digits confirm kar dijiye.' },
  ]);

  assert.deepEqual(route, {
    intent: 'payment.failed',
    authTier: 'Tier B',
    tools: ['verify_read_access', 'get_payment_reconciliation_status'],
  });

  assert.deepEqual(
    routeStableTurn('14 August 1991', [
      { role: 'user', text: 'Mera KYC status batao' },
      { role: 'model', text: 'Verification ke liye mobile number ke last four digits bata dijiye.' },
      { role: 'user', text: '3210' },
      { role: 'model', text: 'Kripya date of birth batayein.' },
    ]),
    {
      intent: 'kyc.status',
      authTier: 'Tier B',
      tools: ['verify_read_access', 'get_kyc_status'],
    },
  );
});

test('resolveStableTurnRoute treats polite no-thanks exits as goodbye instead of reusing payment history', async () => {
  resetIntentClassificationCacheForTests();
  let calls = 0;
  const fetcher = (async () => {
    calls += 1;
    return {
      ok: true,
      status: 200,
      json: async () => ({
        output: [
          {
            type: 'message',
            content: [
              {
                type: 'output_text',
                text: JSON.stringify({
                  intent: 'payment.summary',
                  auth_tier: 'Tier B',
                  confidence: 0.88,
                  reason: 'Would be wrong if this classifier were reached.',
                }),
              },
            ],
          },
        ],
      }),
    } as Response;
  }) as typeof fetch;

  const route = await resolveStableTurnRoute({
    apiKey: 'test-openai-key',
    transcript: 'no thank u',
    history: [
      { role: 'user', text: 'mujhe mere payments ke bare me batao' },
      { role: 'model', text: 'Aapke payment records available hain. Kuch aur madad chahiye?' },
    ],
    fetcher,
  });

  assert.equal(calls, 0);
  assert.deepEqual(route, {
    intent: 'conversation.goodbye',
    authTier: 'Tier A',
    tools: [],
  });
});

test('routeStableIntent returns unknown for unclear turns instead of guessing', () => {
  assert.deepEqual(routeStableIntent('haan woh wala'), {
    intent: 'unknown',
    authTier: 'Tier A',
    tools: [],
  });
});

test('classifyStableIntentWithAI maps fuzzy Hinglish money issues to a fixed code-owned policy', async () => {
  resetIntentClassificationCacheForTests();
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(url), init });
    return {
      ok: true,
      status: 200,
      json: async () => ({
        output: [
          {
            type: 'message',
            content: [
              {
                type: 'output_text',
                text: JSON.stringify({
                  intent: 'payment.failed',
                  auth_tier: 'Tier B',
                  confidence: 0.91,
                  reason: 'Caller says amount is stuck and FD is not visible.',
                }),
              },
            ],
          },
        ],
      }),
    } as Response;
  }) as typeof fetch;

  const result = await classifyStableIntentWithAI({
    apiKey: 'test-openai-key',
    transcript: 'mera amount atak gaya hai, FD dikh nahi raha',
    history: [],
    fetcher,
  });

  assert.deepEqual(result.route, {
    intent: 'payment.failed',
    authTier: 'Tier B',
    tools: ['verify_read_access', 'get_payment_reconciliation_status'],
  });
  assert.equal(result.accepted, true);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, 'https://api.openai.com/v1/responses');
  const body = JSON.parse(String(requests[0].init?.body));
  assert.equal(body.max_output_tokens, 8000);
  assert.equal(body.prompt_cache_key, 'stable-intent-classifier-v1');
  assert.equal(body.text.format.type, 'json_schema');
  assert.equal(body.text.format.name, 'stable_intent_classification');
  assert.equal(body.text.format.strict, true);
  assert.match(body.instructions, /any language/i);
  assert.match(body.instructions, /own semantic understanding/i);
  assert.match(body.instructions, /Do not rely on keyword matching/i);
  assert.doesNotMatch(body.input[0].content, /examples/i);
  assert.doesNotMatch(body.input[0].content, /payment debit hua but FD nahi bana/);
  assert.equal(body.input[0].content.includes('"authTier":"Tier B"'), true);
  assert.deepEqual(body.text.format.schema.properties.intent.enum, [
    'payment.failed',
    'fd.book.status',
    'fd.withdraw.premature',
    'kyc.status',
    'kyc.explainer',
    'fd.rates.compare',
    'maturity.payout.delay',
    'app.real.check',
    'ticket.status',
    'grievance.escalate',
    'support.contact',
    'payment.summary',
    'fd.summary',
    'account.overview',
    'refund.status',
    'secure.action.help',
    'conversation.goodbye',
    'unknown',
  ]);
});

test('classifyStableIntentWithAI routes caller farewell to terminal goodbye policy', async () => {
  resetIntentClassificationCacheForTests();
  const fetcher = (async () =>
    ({
      ok: true,
      status: 200,
      json: async () => ({
        output: [
          {
            type: 'message',
            content: [
              {
                type: 'output_text',
                text: JSON.stringify({
                  intent: 'conversation.goodbye',
                  auth_tier: 'Tier A',
                  confidence: 0.94,
                  reason: 'Caller is ending the conversation.',
                }),
              },
            ],
          },
        ],
      }),
    }) as Response) as typeof fetch;

  const result = await classifyStableIntentWithAI({
    apiKey: 'test-openai-key',
    transcript: 'theek hai thanks, ab main rakhta hoon',
    history: [],
    fetcher,
  });

  assert.equal(result.accepted, true);
  assert.deepEqual(result.route, {
    intent: 'conversation.goodbye',
    authTier: 'Tier A',
    tools: [],
  });
});

test('AI classifier cannot downgrade a known intent tier or tools', async () => {
  resetIntentClassificationCacheForTests();
  const fetcher = (async () =>
    ({
      ok: true,
      status: 200,
      json: async () => ({
        output: [
          {
            type: 'message',
            content: [
              {
                type: 'output_text',
                text: JSON.stringify({
                  intent: 'payment.failed',
                  auth_tier: 'Tier A',
                  confidence: 0.92,
                  reason: 'Wrong tier from model must not own policy.',
                }),
              },
            ],
          },
        ],
      }),
    }) as Response) as typeof fetch;

  const result = await classifyStableIntentWithAI({
    apiKey: 'test-openai-key',
    transcript: 'amount stuck',
    history: [],
    fetcher,
  });

  assert.equal(result.accepted, true);
  assert.equal(result.modelAuthTier, 'Tier A');
  assert.deepEqual(result.route, {
    intent: 'payment.failed',
    authTier: 'Tier B',
    tools: ['verify_read_access', 'get_payment_reconciliation_status'],
  });
});

test('classifyStableIntentWithAI reads structured output text from any Responses message item', async () => {
  resetIntentClassificationCacheForTests();
  const fetcher = (async () =>
    ({
      ok: true,
      status: 200,
      json: async () => ({
        output: [
          {
            type: 'reasoning',
            summary: [],
          },
          {
            type: 'message',
            content: [
              {
                type: 'output_text',
                text: JSON.stringify({
                  intent: 'fd.book.status',
                  auth_tier: 'Tier B',
                  confidence: 0.86,
                  reason: 'Caller asks whether FD was booked.',
                }),
              },
            ],
          },
        ],
      }),
    }) as Response) as typeof fetch;

  const result = await classifyStableIntentWithAI({
    apiKey: 'test-openai-key',
    transcript: 'FD book hua kya',
    history: [],
    fetcher,
  });

  assert.equal(result.accepted, true);
  assert.deepEqual(result.route, {
    intent: 'fd.book.status',
    authTier: 'Tier B',
    tools: ['verify_read_access', 'get_fd_booking_status'],
  });
});

test('classifyStableIntentWithAI retries once when a completed classifier response has no usable JSON', async () => {
  resetIntentClassificationCacheForTests();
  let calls = 0;
  const requestBodies: Array<{ max_output_tokens?: number }> = [];
  const fetcher = (async (_url: string | URL | Request, init?: RequestInit) => {
    calls += 1;
    requestBodies.push(JSON.parse(String(init?.body)));
    return {
      ok: true,
      status: 200,
      json: async () =>
        calls === 1
          ? {
              status: 'completed',
              output: [
                {
                  type: 'reasoning',
                  summary: [],
                },
              ],
            }
          : {
              status: 'completed',
              output: [
                {
                  type: 'message',
                  content: [
                    {
                      type: 'output_text',
                      text: JSON.stringify({
                        intent: 'refund.status',
                        auth_tier: 'Tier B',
                        confidence: 0.9,
                        reason: 'Caller asks about refund ETA.',
                      }),
                    },
                  ],
                },
              ],
            },
    } as Response;
  }) as typeof fetch;

  const result = await classifyStableIntentWithAI({
    apiKey: 'test-openai-key',
    transcript: 'refund kab milega',
    history: [],
    fetcher,
  });

  assert.equal(calls, 2);
  assert.deepEqual(
    requestBodies.map((body) => body.max_output_tokens),
    [8000, 8000],
  );
  assert.equal(result.accepted, true);
  assert.deepEqual(result.route, {
    intent: 'refund.status',
    authTier: 'Tier B',
    tools: ['verify_read_access', 'get_refund_status'],
  });
});

test('classifyStableIntentWithAI handles OpenAI HTTP failures without console logging', async () => {
  resetIntentClassificationCacheForTests();
  const fetcher = (async () =>
    ({
      ok: false,
      status: 503,
      text: async () => 'upstream overloaded',
    }) as Response) as typeof fetch;

  const result = await classifyStableIntentWithAI({
    apiKey: 'test-openai-key',
    transcript: 'mujhe mere payments ke bare me batao',
    history: [{ role: 'user', text: 'hello' }],
    fetcher,
  });

  assert.equal(result.accepted, false);
  assert.equal(result.reason, 'classifier_status_503');
});

test('resolveStableTurnRoute uses deterministic routing before AI and caches the result', async () => {
  resetIntentClassificationCacheForTests();
  let calls = 0;
  const fetcher = (async () => {
    calls += 1;
    return {
      ok: true,
      status: 200,
      json: async () => ({
        output: [
          {
            type: 'message',
            content: [
              {
                type: 'output_text',
                text: JSON.stringify({
                  intent: 'payment.failed',
                  auth_tier: 'Tier B',
                  confidence: 0.89,
                  reason: 'Amount stuck means payment issue.',
                }),
              },
            ],
          },
        ],
      }),
    } as Response;
  }) as typeof fetch;

  const first = await resolveStableTurnRoute({
    apiKey: 'test-openai-key',
    transcript: 'payment debit hua',
    history: [],
    fetcher,
  });
  const second = await resolveStableTurnRoute({
    apiKey: 'test-openai-key',
    transcript: 'payment debit hua',
    history: [],
    fetcher,
  });

  assert.equal(first.intent, 'payment.failed');
  assert.equal(second.intent, 'payment.failed');
  assert.equal(calls, 0);
});

test('resolveStableTurnRoute keeps the active intent for verification answers without AI', async () => {
  resetIntentClassificationCacheForTests();
  let calls = 0;
  const fetcher = (async () => {
    calls += 1;
    return {
      ok: true,
      status: 200,
      json: async () => ({
        output: [
          {
            type: 'message',
            content: [
              {
                type: 'output_text',
                text: JSON.stringify({
                  intent: 'unknown',
                  auth_tier: 'unknown',
                  confidence: 0.3,
                  reason: 'Just four digits without enough context.',
                }),
              },
            ],
          },
        ],
      }),
    } as Response;
  }) as typeof fetch;

  const route = await resolveStableTurnRoute({
    apiKey: 'test-openai-key',
    transcript: '1234',
    history: [
      { role: 'user', text: 'payment debit hua but FD nahi bana' },
      { role: 'model', text: 'Please confirm the last four digits of your mobile number.' },
    ],
    fetcher,
  });

  assert.equal(calls, 0);
  assert.deepEqual(route, {
    intent: 'payment.failed',
    authTier: 'Tier B',
    tools: ['verify_read_access', 'get_payment_reconciliation_status'],
  });
});

test('resolveStableTurnRoute uses deterministic Hindi payment wording before classifier fallback', async () => {
  resetIntentClassificationCacheForTests();
  let calls = 0;
  const fetcher = (async () => {
    calls += 1;
    return {
      ok: true,
      status: 200,
      json: async () => ({
        output: [
          {
            type: 'message',
            content: [
              {
                type: 'output_text',
                text: JSON.stringify({
                  intent: 'unknown',
                  auth_tier: 'unknown',
                  confidence: 0.2,
                  reason: 'Classifier missed the Hindi payment phrase.',
                }),
              },
            ],
          },
        ],
      }),
    } as Response;
  }) as typeof fetch;

  const route = await resolveStableTurnRoute({
    apiKey: 'test-openai-key',
    transcript: 'मेरा पेमेंट फेल हो गया है।',
    history: [],
    fetcher,
  });

  assert.equal(calls, 0);
  assert.deepEqual(route, {
    intent: 'payment.failed',
    authTier: 'Tier B',
    tools: ['verify_read_access', 'get_payment_reconciliation_status'],
  });
});

test('resolveStableTurnRoute uses deterministic Urdu-script payment wording before classifier fallback', async () => {
  resetIntentClassificationCacheForTests();
  let calls = 0;
  const fetcher = (async () => {
    calls += 1;
    return {
      ok: true,
      status: 200,
      json: async () => ({
        output: [
          {
            type: 'message',
            content: [
              {
                type: 'output_text',
                text: JSON.stringify({
                  intent: 'unknown',
                  auth_tier: 'unknown',
                  confidence: 0.2,
                  reason: 'Classifier missed the Urdu-script payment phrase.',
                }),
              },
            ],
          },
        ],
      }),
    } as Response;
  }) as typeof fetch;

  const route = await resolveStableTurnRoute({
    apiKey: 'test-openai-key',
    transcript: 'میرا پیمنٹ فیل ہو گیا ہے۔',
    history: [],
    fetcher,
  });

  assert.equal(calls, 0);
  assert.deepEqual(route, {
    intent: 'payment.failed',
    authTier: 'Tier B',
    tools: ['verify_read_access', 'get_payment_reconciliation_status'],
  });
});

test('resolveStableTurnRoute falls back to AI for unknown deterministic turns', async () => {
  resetIntentClassificationCacheForTests();
  let calls = 0;
  const fetcher = (async () => {
    calls += 1;
    return {
      ok: true,
      status: 200,
      json: async () => ({
        output: [
          {
            type: 'message',
            content: [
              {
                type: 'output_text',
                text: JSON.stringify({
                  intent: 'account.overview',
                  auth_tier: 'Tier A',
                  confidence: 0.86,
                  reason: 'Contextually asks for account overview.',
                }),
              },
            ],
          },
        ],
      }),
    } as Response;
  }) as typeof fetch;

  const route = await resolveStableTurnRoute({
    apiKey: 'test-openai-key',
    transcript: 'mujhe details batao',
    history: [],
    fetcher,
  });

  assert.equal(calls, 1);
  assert.deepEqual(route, {
    intent: 'account.overview',
    authTier: 'Tier A',
    tools: ['get_account_overview'],
  });
});

test('resolveStableTurnRoute sends only the last four messages to AI fallback', async () => {
  resetIntentClassificationCacheForTests();
  let recentHistory: Array<{ role: string; text: string }> | null = null;
  const fetcher = (async (_url: string | URL | Request, init?: RequestInit) => {
    const requestBody = JSON.parse(String(init?.body));
    const classifierPayload = JSON.parse(requestBody.input[0].content);
    recentHistory = classifierPayload.recent_history;
    return {
      ok: true,
      status: 200,
      json: async () => ({
        output: [
          {
            type: 'message',
            content: [
              {
                type: 'output_text',
                text: JSON.stringify({
                  intent: 'unknown',
                  auth_tier: 'unknown',
                  confidence: 0.3,
                  reason: 'Unclear current turn.',
                }),
              },
            ],
          },
        ],
      }),
    } as Response;
  }) as typeof fetch;

  await resolveStableTurnRoute({
    apiKey: 'test-openai-key',
    transcript: 'mujhe details batao',
    history: [
      { role: 'user', text: 'old payment question' },
      { role: 'model', text: 'old payment answer' },
      { role: 'user', text: 'old kyc question' },
      { role: 'model', text: 'old kyc answer' },
      { role: 'user', text: 'recent support question' },
      { role: 'model', text: 'recent support answer' },
    ],
    fetcher,
  });

  assert.deepEqual(recentHistory, [
    { role: 'user', text: 'old kyc question' },
    { role: 'model', text: 'old kyc answer' },
    { role: 'user', text: 'recent support question' },
    { role: 'model', text: 'recent support answer' },
  ]);
});

test('classifyStableIntentWithAI routes payment.summary when caller asks for general payment overview', async () => {
  resetIntentClassificationCacheForTests();
  const fetcher = (async () =>
    ({
      ok: true,
      status: 200,
      json: async () => ({
        output: [
          {
            type: 'message',
            content: [
              {
                type: 'output_text',
                text: JSON.stringify({
                  intent: 'payment.summary',
                  auth_tier: 'Tier B',
                  confidence: 0.88,
                  reason: 'Caller asking for payment history and status overview without issue framing.',
                }),
              },
            ],
          },
        ],
      }),
    }) as Response) as typeof fetch;

  const result = await classifyStableIntentWithAI({
    apiKey: 'test-openai-key',
    transcript: 'mujhe mere payments ke bare me batao',
    history: [],
    fetcher,
  });

  assert.equal(result.accepted, true);
  assert.deepEqual(result.route, {
    intent: 'payment.summary',
    authTier: 'Tier B',
    tools: ['verify_read_access', 'get_payment_summary'],
  });
});

test('classifyStableIntentWithAI routes fd.summary when caller asks for FD overview', async () => {
  resetIntentClassificationCacheForTests();
  const fetcher = (async () =>
    ({
      ok: true,
      status: 200,
      json: async () => ({
        output: [
          {
            type: 'message',
            content: [
              {
                type: 'output_text',
                text: JSON.stringify({
                  intent: 'fd.summary',
                  auth_tier: 'Tier B',
                  confidence: 0.92,
                  reason: 'Caller asking for list of all FDs and deposit details.',
                }),
              },
            ],
          },
        ],
      }),
    }) as Response) as typeof fetch;

  const result = await classifyStableIntentWithAI({
    apiKey: 'test-openai-key',
    transcript: 'meri FDs batao',
    history: [],
    fetcher,
  });

  assert.equal(result.accepted, true);
  assert.deepEqual(result.route, {
    intent: 'fd.summary',
    authTier: 'Tier B',
    tools: ['verify_read_access', 'get_fd_summary'],
  });
});

test('classifyStableIntentWithAI routes account.overview when caller asks for general account status', async () => {
  resetIntentClassificationCacheForTests();
  const fetcher = (async () =>
    ({
      ok: true,
      status: 200,
      json: async () => ({
        output: [
          {
            type: 'message',
            content: [
              {
                type: 'output_text',
                text: JSON.stringify({
                  intent: 'account.overview',
                  auth_tier: 'Tier A',
                  confidence: 0.85,
                  reason: 'Caller asking for general account snapshot and what they have.',
                }),
              },
            ],
          },
        ],
      }),
    }) as Response) as typeof fetch;

  const result = await classifyStableIntentWithAI({
    apiKey: 'test-openai-key',
    transcript: 'mera account batao',
    history: [],
    fetcher,
  });

  assert.equal(result.accepted, true);
  assert.deepEqual(result.route, {
    intent: 'account.overview',
    authTier: 'Tier A',
    tools: ['get_account_overview'],
  });
});

test('classifyStableIntentWithAI routes refund.status when caller asks when refund will arrive', async () => {
  resetIntentClassificationCacheForTests();
  const fetcher = (async () =>
    ({
      ok: true,
      status: 200,
      json: async () => ({
        output: [
          {
            type: 'message',
            content: [
              {
                type: 'output_text',
                text: JSON.stringify({
                  intent: 'refund.status',
                  auth_tier: 'Tier B',
                  confidence: 0.9,
                  reason: 'Caller asking about refund timing and ETA.',
                }),
              },
            ],
          },
        ],
      }),
    }) as Response) as typeof fetch;

  const result = await classifyStableIntentWithAI({
    apiKey: 'test-openai-key',
    transcript: 'refund kab aayega',
    history: [],
    fetcher,
  });

  assert.equal(result.accepted, true);
  assert.deepEqual(result.route, {
    intent: 'refund.status',
    authTier: 'Tier B',
    tools: ['verify_read_access', 'get_refund_status'],
  });
});

test('classifyStableIntentWithAI routes secure.action.help when caller wants to change account details', async () => {
  resetIntentClassificationCacheForTests();
  const fetcher = (async () =>
    ({
      ok: true,
      status: 200,
      json: async () => ({
        output: [
          {
            type: 'message',
            content: [
              {
                type: 'output_text',
                text: JSON.stringify({
                  intent: 'secure.action.help',
                  auth_tier: 'Tier C',
                  confidence: 0.87,
                  reason: 'Caller requesting mobile number change, requires secure link.',
                }),
              },
            ],
          },
        ],
      }),
    }) as Response) as typeof fetch;

  const result = await classifyStableIntentWithAI({
    apiKey: 'test-openai-key',
    transcript: 'mobile number change karna hai',
    history: [],
    fetcher,
  });

  assert.equal(result.accepted, true);
  assert.deepEqual(result.route, {
    intent: 'secure.action.help',
    authTier: 'Tier C',
    tools: ['send_secure_link', 'create_support_ticket'],
  });
});


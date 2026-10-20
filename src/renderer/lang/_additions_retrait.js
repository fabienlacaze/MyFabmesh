/* FabMesh i18n — traductions de « Modify image : retrait et remplacement » (2026-10-20).
 * FICHIER COMMUN bureau / web : src/renderer/lang/_additions_retrait.js = cloud/public/app/lang/_additions_retrait.js
 * (build/check-noyaux-partages.mjs refuse une construction ou les deux copies different).
 * Charge APRES i18n.js, lang/{es,zh,hi,ar}.js et _additions1-6 (index2.html / index.html).
 * Fichier separe de _additions6.js pour ne pas se disputer la fin de sa table avec les autres lots.
 *
 * Une ligne par texte anglais EXACT (la cle) : [francais, espagnol, chinois, hindi, arabe]. Les gabarits {x} / {y}
 * sont remplis dans l'ORDRE d'apparition (tf, i18n.js). Garde : build/check-traductions.mjs.
 * Aucun nom de moteur dans ces textes (regle de l'exploitant).
 */
(function () {
  if (!window.FabI18n || !window.FabI18n.register) return;
  var L = ['fr', 'es', 'zh', 'hi', 'ar'];
  var T = {
    "Erases \"{x}\" and fills the gap. The Strength slider is not used.": [
      "Efface « {x} » et comble le vide. Le curseur Intensité n'est pas utilisé.",
      "Borra «{x}» y rellena el hueco. El control Intensidad no se usa.",
      "擦除“{x}”并补全空缺。“强度”滑块在此不起作用。",
      "\"{x}\" को मिटाकर खाली जगह भरी जाएगी। \"तीव्रता\" स्लाइडर यहाँ काम नहीं करता।",
      "سيتم مسح \"{x}\" وملء الفراغ. شريط \"الشدة\" غير مستخدم هنا."],
    "Replaces \"{x}\" with \"{y}\". The Strength slider is not used.": [
      "Remplace « {x} » par « {y} ». Le curseur Intensité n'est pas utilisé.",
      "Sustituye «{x}» por «{y}». El control Intensidad no se usa.",
      "将“{x}”替换为“{y}”。“强度”滑块在此不起作用。",
      "\"{x}\" को \"{y}\" से बदला जाएगा। \"तीव्रता\" स्लाइडर यहाँ काम नहीं करता।",
      "سيتم استبدال \"{x}\" بـ \"{y}\". شريط \"الشدة\" غير مستخدم هنا."],
    "To remove something, ask for it on its own (for example \"remove the wings\"), then make the other changes in a second step.": [
      "Pour retirer un élément, demandez-le seul (par exemple « enlève les ailes »), puis faites les autres changements dans un second temps.",
      "Para quitar algo, pídelo solo (por ejemplo «quita las alas») y haz los demás cambios en un segundo paso.",
      "要去掉某样东西，请单独提出（例如“去掉翅膀”），其他修改放到第二步再做。",
      "किसी चीज़ को हटाने के लिए उसे अकेले कहें (जैसे \"पंख हटाओ\"), बाकी बदलाव दूसरे चरण में करें।",
      "لإزالة شيء ما، اطلبه وحده (مثل \"أزل الأجنحة\") ثم أجرِ بقية التغييرات في خطوة ثانية."],
    "Not used when erasing or replacing": [
      "Inutilisé pour effacer ou remplacer",
      "No se usa al borrar ni al sustituir",
      "擦除或替换时不起作用",
      "मिटाने या बदलने पर इसका उपयोग नहीं होता",
      "لا يُستخدم عند المسح أو الاستبدال"],
    "This is a removal: \"{x}\" will be erased with the removal tool, which costs {y} credits. Continue?": [
      "Il s'agit d'un retrait : « {x} » sera effacé avec l'outil de retrait, qui coûte {y} crédits. Continuer ?",
      "Es una eliminación: «{x}» se borrará con la herramienta de eliminación, que cuesta {y} créditos. ¿Continuar?",
      "这是删除操作：将用删除工具擦除“{x}”，需要 {y} 积分。继续吗？",
      "यह हटाने का अनुरोध है: \"{x}\" को हटाने वाले टूल से मिटाया जाएगा, जिसकी कीमत {y} क्रेडिट है। जारी रखें?",
      "هذا طلب إزالة: سيتم مسح \"{x}\" بأداة الإزالة، وتكلفتها {y} رصيد. هل تريد المتابعة؟"],
    "\"{x}\" was not found in the image. Try a simpler word, or use Auto Inpaint.": [
      "« {x} » est introuvable dans l'image. Essayez un mot plus simple, ou utilisez Auto Inpaint.",
      "No se encontró «{x}» en la imagen. Prueba con una palabra más sencilla o usa Auto Inpaint.",
      "在图像中未找到“{x}”。请换一个更简单的词，或使用 Auto Inpaint。",
      "छवि में \"{x}\" नहीं मिला। कोई सरल शब्द आज़माएँ, या Auto Inpaint का उपयोग करें।",
      "لم يتم العثور على \"{x}\" في الصورة. جرّب كلمة أبسط أو استخدم Auto Inpaint."],
    "No credits were used.": [
      "Aucun crédit n'a été utilisé.",
      "No se ha usado ningún crédito.",
      "未扣除任何积分。",
      "कोई क्रेडिट खर्च नहीं हुआ।",
      "لم يُستخدم أي رصيد."]
  };
  for (var i = 0; i < L.length; i++) {
    var d = {};
    for (var k in T) { if (Object.prototype.hasOwnProperty.call(T, k) && T[k][i]) d[k] = T[k][i]; }
    window.FabI18n.register(L[i], d);
  }
  if (L.indexOf(window.FabI18n.lang) !== -1) window.FabI18n.applyLang(window.FabI18n.lang);
})();

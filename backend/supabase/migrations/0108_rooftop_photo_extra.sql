-- 0108 — More rooftop photos for a commercial loan (EPC chatbot).
-- The first rooftop photo stays 'borrower_photo' (its upload replaces that
-- category); every further geo-tagged rooftop photo is its own row of this
-- category, so re-uploading the first never removes them.
alter type loan_doc_category add value if not exists 'rooftop_photo_extra';

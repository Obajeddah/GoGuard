CREATE POLICY "Org users read their org photos" ON storage.objects
FOR SELECT TO authenticated
USING (bucket_id = 'photos' AND (storage.foldername(name))[1] = public.get_user_org_id(auth.uid())::text);

CREATE POLICY "Admins upload org photos" ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'photos' AND (storage.foldername(name))[1] = public.get_user_org_id(auth.uid())::text AND public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins update org photos" ON storage.objects
FOR UPDATE TO authenticated
USING (bucket_id = 'photos' AND (storage.foldername(name))[1] = public.get_user_org_id(auth.uid())::text AND public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins delete org photos" ON storage.objects
FOR DELETE TO authenticated
USING (bucket_id = 'photos' AND (storage.foldername(name))[1] = public.get_user_org_id(auth.uid())::text AND public.has_role(auth.uid(), 'admin'));

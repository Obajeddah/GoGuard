export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.18";
  };
  public: {
    Tables: {
      branches: {
        Row: {
          address: string | null;
          created_at: string;
          guard_invite_token: string;
          id: string;
          is_main: boolean;
          name: string;
          org_id: string;
          registration_token: string;
        };
        Insert: {
          address?: string | null;
          created_at?: string;
          guard_invite_token?: string;
          id?: string;
          is_main?: boolean;
          name: string;
          org_id: string;
          registration_token?: string;
        };
        Update: {
          address?: string | null;
          created_at?: string;
          guard_invite_token?: string;
          id?: string;
          is_main?: boolean;
          name?: string;
          org_id?: string;
          registration_token?: string;
        };
        Relationships: [
          {
            foreignKeyName: "branches_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      bus_crew: {
        Row: {
          active_date: string;
          attendant_profile_id: string | null;
          branch_id: string | null;
          bus_id: string;
          driver_profile_id: string | null;
          id: string;
          org_id: string;
          updated_at: string;
        };
        Insert: {
          active_date?: string;
          attendant_profile_id?: string | null;
          branch_id?: string | null;
          bus_id: string;
          driver_profile_id?: string | null;
          id?: string;
          org_id: string;
          updated_at?: string;
        };
        Update: {
          active_date?: string;
          attendant_profile_id?: string | null;
          branch_id?: string | null;
          bus_id?: string;
          driver_profile_id?: string | null;
          id?: string;
          org_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "bus_crew_attendant_profile_id_fkey";
            columns: ["attendant_profile_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "bus_crew_branch_id_fkey";
            columns: ["branch_id"];
            isOneToOne: false;
            referencedRelation: "branches";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "bus_crew_bus_id_fkey";
            columns: ["bus_id"];
            isOneToOne: true;
            referencedRelation: "buses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "bus_crew_driver_profile_id_fkey";
            columns: ["driver_profile_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "bus_crew_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      bus_emergencies: {
        Row: {
          branch_id: string | null;
          bus_id: string;
          client_id: string;
          created_at: string;
          emailed_at: string | null;
          id: string;
          lat: number | null;
          lng: number | null;
          org_id: string;
          raised_by: string;
          resolved_at: string | null;
          resolved_by: string | null;
          trip_id: string | null;
        };
        Insert: {
          branch_id?: string | null;
          bus_id: string;
          client_id?: string;
          created_at?: string;
          emailed_at?: string | null;
          id?: string;
          lat?: number | null;
          lng?: number | null;
          org_id: string;
          raised_by: string;
          resolved_at?: string | null;
          resolved_by?: string | null;
          trip_id?: string | null;
        };
        Update: {
          branch_id?: string | null;
          bus_id?: string;
          client_id?: string;
          created_at?: string;
          emailed_at?: string | null;
          id?: string;
          lat?: number | null;
          lng?: number | null;
          org_id?: string;
          raised_by?: string;
          resolved_at?: string | null;
          resolved_by?: string | null;
          trip_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "bus_emergencies_branch_id_fkey";
            columns: ["branch_id"];
            isOneToOne: false;
            referencedRelation: "branches";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "bus_emergencies_bus_id_fkey";
            columns: ["bus_id"];
            isOneToOne: false;
            referencedRelation: "buses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "bus_emergencies_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "bus_emergencies_trip_id_fkey";
            columns: ["trip_id"];
            isOneToOne: false;
            referencedRelation: "bus_trips";
            referencedColumns: ["id"];
          },
        ];
      };
      bus_trip_points: {
        Row: {
          branch_id: string | null;
          client_id: string;
          heading: number | null;
          id: string;
          lat: number;
          lng: number;
          org_id: string;
          recorded_at: string;
          speed: number | null;
          trip_id: string;
        };
        Insert: {
          branch_id?: string | null;
          client_id?: string;
          heading?: number | null;
          id?: string;
          lat: number;
          lng: number;
          org_id: string;
          recorded_at?: string;
          speed?: number | null;
          trip_id: string;
        };
        Update: {
          branch_id?: string | null;
          client_id?: string;
          heading?: number | null;
          id?: string;
          lat?: number;
          lng?: number;
          org_id?: string;
          recorded_at?: string;
          speed?: number | null;
          trip_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "bus_trip_points_branch_id_fkey";
            columns: ["branch_id"];
            isOneToOne: false;
            referencedRelation: "branches";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "bus_trip_points_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "bus_trip_points_trip_id_fkey";
            columns: ["trip_id"];
            isOneToOne: false;
            referencedRelation: "bus_trips";
            referencedColumns: ["id"];
          },
        ];
      };
      bus_trips: {
        Row: {
          branch_id: string | null;
          bus_id: string;
          created_at: string;
          current_heading: number | null;
          current_lat: number | null;
          current_lng: number | null;
          current_speed: number | null;
          direction: string;
          ended_at: string | null;
          id: string;
          last_ping_at: string | null;
          location_paused: boolean;
          location_requested_at: string | null;
          org_id: string;
          started_at: string | null;
          started_by: string | null;
          status: string;
        };
        Insert: {
          branch_id?: string | null;
          bus_id: string;
          created_at?: string;
          current_heading?: number | null;
          current_lat?: number | null;
          current_lng?: number | null;
          current_speed?: number | null;
          direction?: string;
          ended_at?: string | null;
          id?: string;
          last_ping_at?: string | null;
          location_paused?: boolean;
          location_requested_at?: string | null;
          org_id: string;
          started_at?: string | null;
          started_by?: string | null;
          status?: string;
        };
        Update: {
          branch_id?: string | null;
          bus_id?: string;
          created_at?: string;
          current_heading?: number | null;
          current_lat?: number | null;
          current_lng?: number | null;
          current_speed?: number | null;
          direction?: string;
          ended_at?: string | null;
          id?: string;
          last_ping_at?: string | null;
          location_paused?: boolean;
          location_requested_at?: string | null;
          org_id?: string;
          started_at?: string | null;
          started_by?: string | null;
          status?: string;
        };
        Relationships: [
          {
            foreignKeyName: "bus_trips_branch_id_fkey";
            columns: ["branch_id"];
            isOneToOne: false;
            referencedRelation: "branches";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "bus_trips_bus_id_fkey";
            columns: ["bus_id"];
            isOneToOne: false;
            referencedRelation: "buses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "bus_trips_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      buses: {
        Row: {
          attendant_name: string | null;
          attendant_phone: string | null;
          branch_id: string | null;
          bus_number: string;
          created_at: string;
          driver_name: string | null;
          driver_phone: string | null;
          id: string;
          login_active: boolean;
          login_email: string | null;
          login_user_id: string | null;
          org_id: string;
          plate_number: string;
          route_axis: string;
        };
        Insert: {
          attendant_name?: string | null;
          attendant_phone?: string | null;
          branch_id?: string | null;
          bus_number: string;
          created_at?: string;
          driver_name?: string | null;
          driver_phone?: string | null;
          id?: string;
          login_active?: boolean;
          login_email?: string | null;
          login_user_id?: string | null;
          org_id: string;
          plate_number: string;
          route_axis?: string;
        };
        Update: {
          attendant_name?: string | null;
          attendant_phone?: string | null;
          branch_id?: string | null;
          bus_number?: string;
          created_at?: string;
          driver_name?: string | null;
          driver_phone?: string | null;
          id?: string;
          login_active?: boolean;
          login_email?: string | null;
          login_user_id?: string | null;
          org_id?: string;
          plate_number?: string;
          route_axis?: string;
        };
        Relationships: [
          {
            foreignKeyName: "buses_branch_id_fkey";
            columns: ["branch_id"];
            isOneToOne: false;
            referencedRelation: "branches";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "buses_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      email_deliveries: {
        Row: {
          email: string;
          id: string;
          sent_at: string;
          source_id: string;
          source_table: string;
        };
        Insert: {
          email: string;
          id?: string;
          sent_at?: string;
          source_id: string;
          source_table: string;
        };
        Update: {
          email?: string;
          id?: string;
          sent_at?: string;
          source_id?: string;
          source_table?: string;
        };
        Relationships: [];
      };
      gate_logs: {
        Row: {
          action_type: Database["public"]["Enums"]["gate_action"];
          branch_id: string | null;
          client_id: string | null;
          emailed_at: string | null;
          guard_name: string | null;
          guardian_id: string | null;
          id: string;
          member_id: string;
          member_name: string | null;
          org_id: string;
          scanned_by_guard_id: string;
          timestamp: string;
          verified_guardian_name: string | null;
        };
        Insert: {
          action_type: Database["public"]["Enums"]["gate_action"];
          branch_id?: string | null;
          client_id?: string | null;
          emailed_at?: string | null;
          guard_name?: string | null;
          guardian_id?: string | null;
          id?: string;
          member_id: string;
          member_name?: string | null;
          org_id: string;
          scanned_by_guard_id: string;
          timestamp?: string;
          verified_guardian_name?: string | null;
        };
        Update: {
          action_type?: Database["public"]["Enums"]["gate_action"];
          branch_id?: string | null;
          client_id?: string | null;
          emailed_at?: string | null;
          guard_name?: string | null;
          guardian_id?: string | null;
          id?: string;
          member_id?: string;
          member_name?: string | null;
          org_id?: string;
          scanned_by_guard_id?: string;
          timestamp?: string;
          verified_guardian_name?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "gate_logs_branch_id_fkey";
            columns: ["branch_id"];
            isOneToOne: false;
            referencedRelation: "branches";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "gate_logs_guardian_id_fkey";
            columns: ["guardian_id"];
            isOneToOne: false;
            referencedRelation: "guardians";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "gate_logs_member_id_fkey";
            columns: ["member_id"];
            isOneToOne: false;
            referencedRelation: "members";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "gate_logs_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "gate_logs_scanned_by_guard_id_fkey";
            columns: ["scanned_by_guard_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      guardians: {
        Row: {
          branch_id: string | null;
          created_at: string;
          email: string;
          id: string;
          member_id: string;
          name: string;
          org_id: string;
          phone: string | null;
          photo_path: string | null;
          receive_general_notifications: boolean;
          relationship: string;
          unique_qr_hash: string;
        };
        Insert: {
          branch_id?: string | null;
          created_at?: string;
          email: string;
          id?: string;
          member_id: string;
          name: string;
          org_id: string;
          phone?: string | null;
          photo_path?: string | null;
          receive_general_notifications?: boolean;
          relationship: string;
          unique_qr_hash?: string;
        };
        Update: {
          branch_id?: string | null;
          created_at?: string;
          email?: string;
          id?: string;
          member_id?: string;
          name?: string;
          org_id?: string;
          phone?: string | null;
          photo_path?: string | null;
          receive_general_notifications?: boolean;
          relationship?: string;
          unique_qr_hash?: string;
        };
        Relationships: [
          {
            foreignKeyName: "guardians_branch_id_fkey";
            columns: ["branch_id"];
            isOneToOne: false;
            referencedRelation: "branches";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "guardians_member_id_fkey";
            columns: ["member_id"];
            isOneToOne: false;
            referencedRelation: "members";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "guardians_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      members: {
        Row: {
          branch_id: string;
          bus_id: string | null;
          bus_track_token: string;
          created_at: string;
          full_name: string;
          id: string;
          identifier_code: string | null;
          org_id: string;
          parent_or_owner_name: string | null;
          parent_app_installed: boolean;
          parent_app_installed_at: string | null;
          parent_link_token: string;
          photo_path: string | null;
          primary_email: string;
          primary_phone: string | null;
          uses_bus: boolean;
        };
        Insert: {
          branch_id: string;
          bus_id?: string | null;
          bus_track_token?: string;
          created_at?: string;
          full_name: string;
          id?: string;
          identifier_code?: string | null;
          org_id: string;
          parent_or_owner_name?: string | null;
          parent_app_installed?: boolean;
          parent_app_installed_at?: string | null;
          parent_link_token?: string;
          photo_path?: string | null;
          primary_email: string;
          primary_phone?: string | null;
          uses_bus?: boolean;
        };
        Update: {
          branch_id?: string;
          bus_id?: string | null;
          bus_track_token?: string;
          created_at?: string;
          full_name?: string;
          id?: string;
          identifier_code?: string | null;
          org_id?: string;
          parent_or_owner_name?: string | null;
          parent_app_installed?: boolean;
          parent_app_installed_at?: string | null;
          parent_link_token?: string;
          photo_path?: string | null;
          primary_email?: string;
          primary_phone?: string | null;
          uses_bus?: boolean;
        };
        Relationships: [
          {
            foreignKeyName: "members_branch_id_fkey";
            columns: ["branch_id"];
            isOneToOne: false;
            referencedRelation: "branches";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "members_bus_id_fkey";
            columns: ["bus_id"];
            isOneToOne: false;
            referencedRelation: "buses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "members_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      org_secrets: {
        Row: {
          edit_pin: string;
          failed_attempts: number;
          locked_until: string | null;
          org_id: string;
          updated_at: string;
        };
        Insert: {
          edit_pin?: string;
          failed_attempts?: number;
          locked_until?: string | null;
          org_id: string;
          updated_at?: string;
        };
        Update: {
          edit_pin?: string;
          failed_attempts?: number;
          locked_until?: string | null;
          org_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "org_secrets_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: true;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      parent_pwa_tokens: {
        Row: {
          created_at: string;
          id: string;
          member_id: string;
          org_id: string;
          otp_code: string | null;
          otp_expires_at: string | null;
          otp_verified_at: string | null;
          parent_link_token: string;
          pwa_token: string;
          webauthn_credential_id: string | null;
          last_accessed_at: string | null;
        };
        Insert: {
          created_at?: string;
          id?: string;
          member_id: string;
          org_id: string;
          otp_code?: string | null;
          otp_expires_at?: string | null;
          otp_verified_at?: string | null;
          parent_link_token: string;
          pwa_token: string;
          webauthn_credential_id?: string | null;
          last_accessed_at?: string | null;
        };
        Update: {
          created_at?: string;
          id?: string;
          member_id?: string;
          org_id?: string;
          otp_code?: string | null;
          otp_expires_at?: string | null;
          otp_verified_at?: string | null;
          parent_link_token?: string;
          pwa_token?: string;
          webauthn_credential_id?: string | null;
          last_accessed_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "parent_pwa_tokens_member_id_fkey";
            columns: ["member_id"];
            isOneToOne: false;
            referencedRelation: "members";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "parent_pwa_tokens_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      instant_email_queue: {
        Row: {
          attempts: number;
          created_at: string;
          id: string;
          org_id: string;
          priority: number;
          processed_at: string | null;
          source_id: string;
          source_table: string;
        };
        Insert: {
          attempts?: number;
          created_at?: string;
          id?: string;
          org_id: string;
          priority?: number;
          processed_at?: string | null;
          source_id: string;
          source_table: string;
        };
        Update: {
          attempts?: number;
          created_at?: string;
          id?: string;
          org_id?: string;
          priority?: number;
          processed_at?: string | null;
          source_id?: string;
          source_table?: string;
        };
        Relationships: [
          {
            foreignKeyName: "instant_email_queue_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      organizations: {
        Row: {
          admin_email: string;
          classes: string[];
          created_at: string;
          email_domain: string | null;
          emergency_phone: string | null;
          id: string;
          name: string;
          paid_until: string | null;
          plan: string;
          registration_token: string;
          transport_enabled: boolean;
          transport_paid_until: string | null;
          trial_ends_at: string;
          type: Database["public"]["Enums"]["org_type"];
        };
        Insert: {
          admin_email: string;
          classes?: string[];
          created_at?: string;
          email_domain?: string | null;
          emergency_phone?: string | null;
          id?: string;
          name: string;
          paid_until?: string | null;
          plan?: string;
          registration_token?: string;
          transport_enabled?: boolean;
          transport_paid_until?: string | null;
          trial_ends_at?: string;
          type: Database["public"]["Enums"]["org_type"];
        };
        Update: {
          admin_email?: string;
          classes?: string[];
          created_at?: string;
          email_domain?: string | null;
          emergency_phone?: string | null;
          id?: string;
          name?: string;
          paid_until?: string | null;
          plan?: string;
          registration_token?: string;
          transport_enabled?: boolean;
          transport_paid_until?: string | null;
          trial_ends_at?: string;
          type?: Database["public"]["Enums"]["org_type"];
        };
        Relationships: [];
      };
      payments: {
        Row: {
          amount_kobo: number;
          branch_count: number | null;
          created_at: string;
          id: string;
          org_id: string;
          paid_at: string | null;
          plan: string;
          reference: string;
          status: string;
        };
        Insert: {
          amount_kobo: number;
          branch_count?: number | null;
          created_at?: string;
          id?: string;
          org_id: string;
          paid_at?: string | null;
          plan: string;
          reference: string;
          status?: string;
        };
        Update: {
          amount_kobo?: number;
          branch_count?: number | null;
          created_at?: string;
          id?: string;
          org_id?: string;
          paid_at?: string | null;
          plan?: string;
          reference?: string;
          status?: string;
        };
        Relationships: [
          {
            foreignKeyName: "payments_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      place_names: {
        Row: {
          created_at: string;
          lat_key: number;
          lng_key: number;
          name: string | null;
        };
        Insert: {
          created_at?: string;
          lat_key: number;
          lng_key: number;
          name?: string | null;
        };
        Update: {
          created_at?: string;
          lat_key?: number;
          lng_key?: number;
          name?: string | null;
        };
        Relationships: [];
      };
      profiles: {
        Row: {
          branch_id: string | null;
          created_at: string;
          email: string | null;
          full_name: string;
          id: string;
          org_id: string;
          phone: string | null;
        };
        Insert: {
          branch_id?: string | null;
          created_at?: string;
          email?: string | null;
          full_name?: string;
          id: string;
          org_id: string;
          phone?: string | null;
        };
        Update: {
          branch_id?: string | null;
          created_at?: string;
          email?: string | null;
          full_name?: string;
          id?: string;
          org_id?: string;
          phone?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "profiles_branch_id_fkey";
            columns: ["branch_id"];
            isOneToOne: false;
            referencedRelation: "branches";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "profiles_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      pupil_bus_logs: {
        Row: {
          branch_id: string | null;
          client_id: string;
          guardian_id: string | null;
          guardian_name: string | null;
          id: string;
          lat: number | null;
          lng: number | null;
          member_id: string;
          org_id: string;
          recorded_by: string;
          status: string;
          timestamp: string;
          trip_id: string;
        };
        Insert: {
          branch_id?: string | null;
          client_id?: string;
          guardian_id?: string | null;
          guardian_name?: string | null;
          id?: string;
          lat?: number | null;
          lng?: number | null;
          member_id: string;
          org_id: string;
          recorded_by: string;
          status: string;
          timestamp?: string;
          trip_id: string;
        };
        Update: {
          branch_id?: string | null;
          client_id?: string;
          guardian_id?: string | null;
          guardian_name?: string | null;
          id?: string;
          lat?: number | null;
          lng?: number | null;
          member_id?: string;
          org_id?: string;
          recorded_by?: string;
          status?: string;
          timestamp?: string;
          trip_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "pupil_bus_logs_branch_id_fkey";
            columns: ["branch_id"];
            isOneToOne: false;
            referencedRelation: "branches";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "pupil_bus_logs_guardian_id_fkey";
            columns: ["guardian_id"];
            isOneToOne: false;
            referencedRelation: "guardians";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "pupil_bus_logs_member_id_fkey";
            columns: ["member_id"];
            isOneToOne: false;
            referencedRelation: "members";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "pupil_bus_logs_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "pupil_bus_logs_trip_id_fkey";
            columns: ["trip_id"];
            isOneToOne: false;
            referencedRelation: "bus_trips";
            referencedColumns: ["id"];
          },
        ];
      };
      signup_tickets: {
        Row: {
          created_at: string;
          email: string;
          id: string;
          plan: string;
          used_at: string | null;
        };
        Insert: {
          created_at?: string;
          email: string;
          id?: string;
          plan?: string;
          used_at?: string | null;
        };
        Update: {
          created_at?: string;
          email?: string;
          id?: string;
          plan?: string;
          used_at?: string | null;
        };
        Relationships: [];
      };
      staff_requests: {
        Row: {
          branch_id: string;
          created_at: string;
          decided_at: string | null;
          decided_by: string | null;
          email: string;
          full_name: string;
          id: string;
          org_id: string;
          phone: string | null;
          status: string;
          user_id: string;
        };
        Insert: {
          branch_id: string;
          created_at?: string;
          decided_at?: string | null;
          decided_by?: string | null;
          email: string;
          full_name: string;
          id?: string;
          org_id: string;
          phone?: string | null;
          status?: string;
          user_id: string;
        };
        Update: {
          branch_id?: string;
          created_at?: string;
          decided_at?: string | null;
          decided_by?: string | null;
          email?: string;
          full_name?: string;
          id?: string;
          org_id?: string;
          phone?: string | null;
          status?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "staff_requests_branch_id_fkey";
            columns: ["branch_id"];
            isOneToOne: false;
            referencedRelation: "branches";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "staff_requests_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      transport_notices: {
        Row: {
          branch_id: string | null;
          bus_id: string | null;
          created_at: string;
          emailed_at: string | null;
          guardian_id: string | null;
          id: string;
          kind: string;
          member_id: string | null;
          message: string;
          org_id: string;
          trip_id: string | null;
        };
        Insert: {
          branch_id?: string | null;
          bus_id?: string | null;
          created_at?: string;
          emailed_at?: string | null;
          guardian_id?: string | null;
          id?: string;
          kind: string;
          member_id?: string | null;
          message: string;
          org_id: string;
          trip_id?: string | null;
        };
        Update: {
          branch_id?: string | null;
          bus_id?: string | null;
          created_at?: string;
          emailed_at?: string | null;
          guardian_id?: string | null;
          id?: string;
          kind?: string;
          member_id?: string | null;
          message?: string;
          org_id?: string;
          trip_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "transport_notices_branch_id_fkey";
            columns: ["branch_id"];
            isOneToOne: false;
            referencedRelation: "branches";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "transport_notices_bus_id_fkey";
            columns: ["bus_id"];
            isOneToOne: false;
            referencedRelation: "buses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "transport_notices_guardian_id_fkey";
            columns: ["guardian_id"];
            isOneToOne: false;
            referencedRelation: "guardians";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "transport_notices_member_id_fkey";
            columns: ["member_id"];
            isOneToOne: false;
            referencedRelation: "members";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "transport_notices_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "transport_notices_trip_id_fkey";
            columns: ["trip_id"];
            isOneToOne: false;
            referencedRelation: "bus_trips";
            referencedColumns: ["id"];
          },
        ];
      };
      user_roles: {
        Row: {
          id: string;
          role: Database["public"]["Enums"]["app_role"];
          user_id: string;
        };
        Insert: {
          id?: string;
          role: Database["public"]["Enums"]["app_role"];
          user_id: string;
        };
        Update: {
          id?: string;
          role?: Database["public"]["Enums"]["app_role"];
          user_id?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      attendance_marks: {
        Args: { _from: string; _to: string };
        Returns: {
          bus_days: string[];
          gate_days: string[];
          member_id: string;
        }[];
      };
      can_operate_trip: {
        Args: { _trip_id: string; _user_id: string };
        Returns: boolean;
      };
      edit_member: {
        Args: {
          _branch_id: string;
          _class: string;
          _email: string;
          _full_name: string;
          _member_id: string;
          _parent_name: string;
          _phone: string;
          _pin: string;
        };
        Returns: string;
      };
      get_registration_branch: {
        Args: { _token: string };
        Returns: {
          branch_count: number;
          branch_id: string;
          branch_name: string;
          classes: string[];
          emergency_phone: string;
          org_id: string;
          org_name: string;
          org_type: Database["public"]["Enums"]["org_type"];
          transport: boolean;
        }[];
      };
      get_registration_classes: { Args: { _token: string }; Returns: string[] };
      get_registration_org: {
        Args: { _token: string };
        Returns: {
          emergency_phone: string;
          id: string;
          name: string;
          type: Database["public"]["Enums"]["org_type"];
        }[];
      };
      get_registration_transport: { Args: { _token: string }; Returns: boolean };
      get_user_branch_id: { Args: { _user_id: string }; Returns: string };
      get_user_org_id: { Args: { _user_id: string }; Returns: string };
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"];
          _user_id: string;
        };
        Returns: boolean;
      };
      in_my_branch: { Args: { _branch_id: string }; Returns: boolean };
      is_bus_crew: {
        Args: { _bus_id: string; _user_id: string };
        Returns: boolean;
      };
      is_free_email_domain: { Args: { _domain: string }; Returns: boolean };
      is_hq_admin: { Args: { _user_id: string }; Returns: boolean };
      main_branch_id: { Args: { _org_id: string }; Returns: string };
      mfa_ok: { Args: never; Returns: boolean };
      org_effective_plan: { Args: { _org_id: string }; Returns: string };
      org_max_buses: { Args: { _org_id: string }; Returns: number };
      org_transport_active: { Args: { _org_id: string }; Returns: boolean };
      photo_in_scope: { Args: { _name: string }; Returns: boolean };
      request_bus_location: { Args: { _trip_id: string }; Returns: undefined };
      settle_paystack_payment: {
        Args: { _amount_kobo: number; _currency: string; _reference: string };
        Returns: string;
      };
      staff_scope: { Args: { _branch_id: string }; Returns: boolean };
    };
    Enums: {
      app_role: "admin" | "guard" | "driver" | "attendant" | "bus";
      gate_action: "check_in" | "check_out";
      org_type: "school" | "estate" | "corporate";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema["CompositeTypes"] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "guard", "driver", "attendant", "bus"],
      gate_action: ["check_in", "check_out"],
      org_type: ["school", "estate", "corporate"],
    },
  },
} as const;

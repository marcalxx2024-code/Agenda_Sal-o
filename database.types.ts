export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      appointment_services: {
        Row: {
          appointment_id: number
          created_at: string
          id: number
          return_due_on: string | null
          return_interval_months: number | null
          service_id: number
          service_name: string
        }
        Insert: {
          appointment_id: number
          created_at?: string
          id?: never
          return_due_on?: string | null
          return_interval_months?: number | null
          service_id: number
          service_name?: string
        }
        Update: {
          appointment_id?: number
          created_at?: string
          id?: never
          return_due_on?: string | null
          return_interval_months?: number | null
          service_id?: number
          service_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "appointment_services_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointment_services_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
        ]
      }
      appointments: {
        Row: {
          client_id: number
          created_at: string
          id: number
          notes: string | null
          performed_on: string
          updated_at: string
        }
        Insert: {
          client_id: number
          created_at?: string
          id?: never
          notes?: string | null
          performed_on: string
          updated_at?: string
        }
        Update: {
          client_id?: number
          created_at?: string
          id?: never
          notes?: string | null
          performed_on?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "appointments_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "pending_returns"
            referencedColumns: ["client_id"]
          },
        ]
      }
      clients: {
        Row: {
          active: boolean
          created_at: string
          id: number
          name: string
          notes: string | null
          phone: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: never
          name: string
          notes?: string | null
          phone: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: never
          name?: string
          notes?: string | null
          phone?: string
          updated_at?: string
        }
        Relationships: []
      }
      returns: {
        Row: {
          appointment_service_id: number
          contact_note: string | null
          contacted_at: string | null
          created_at: string
          due_on: string
          id: number
          status: string
          updated_at: string
        }
        Insert: {
          appointment_service_id: number
          contact_note?: string | null
          contacted_at?: string | null
          created_at?: string
          due_on: string
          id?: never
          status?: string
          updated_at?: string
        }
        Update: {
          appointment_service_id?: number
          contact_note?: string | null
          contacted_at?: string | null
          created_at?: string
          due_on?: string
          id?: never
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "returns_appointment_service_id_fkey"
            columns: ["appointment_service_id"]
            isOneToOne: true
            referencedRelation: "appointment_services"
            referencedColumns: ["id"]
          },
        ]
      }
      services: {
        Row: {
          active: boolean
          created_at: string
          id: number
          name: string
          suggested_return_months: number | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: never
          name: string
          suggested_return_months?: number | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: never
          name?: string
          suggested_return_months?: number | null
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      pending_returns: {
        Row: {
          client_id: number | null
          client_name: string | null
          client_phone: string | null
          contact_note: string | null
          contacted_at: string | null
          due_on: string | null
          id: number | null
          performed_on: string | null
          return_interval_months: number | null
          service_name: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      calendar_months_after: {
        Args: { base_date: string; month_count: number }
        Returns: string
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const

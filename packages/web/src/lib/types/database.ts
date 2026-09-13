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
      admin_audit_log: {
        Row: {
          action: string
          admin_id: string
          created_at: string | null
          id: string
          ip_address: unknown
          metadata: Json | null
          target_id: string | null
          target_type: string | null
          user_agent: string | null
        }
        Insert: {
          action: string
          admin_id: string
          created_at?: string | null
          id?: string
          ip_address?: unknown
          metadata?: Json | null
          target_id?: string | null
          target_type?: string | null
          user_agent?: string | null
        }
        Update: {
          action?: string
          admin_id?: string
          created_at?: string | null
          id?: string
          ip_address?: unknown
          metadata?: Json | null
          target_id?: string | null
          target_type?: string | null
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "admin_audit_log_admin_id_fkey"
            columns: ["admin_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      admin_permissions: {
        Row: {
          created_at: string | null
          id: string
          permission: string
          role: Database["public"]["Enums"]["admin_role"]
        }
        Insert: {
          created_at?: string | null
          id?: string
          permission: string
          role: Database["public"]["Enums"]["admin_role"]
        }
        Update: {
          created_at?: string | null
          id?: string
          permission?: string
          role?: Database["public"]["Enums"]["admin_role"]
        }
        Relationships: []
      }
      analysis_events: {
        Row: {
          event_type: string
          id: string
          payload: Json
          source_event_id: string | null
          timestamp: string
        }
        Insert: {
          event_type: string
          id?: string
          payload: Json
          source_event_id?: string | null
          timestamp?: string
        }
        Update: {
          event_type?: string
          id?: string
          payload?: Json
          source_event_id?: string | null
          timestamp?: string
        }
        Relationships: [
          {
            foreignKeyName: "analysis_events_source_event_id_fkey"
            columns: ["source_event_id"]
            isOneToOne: false
            referencedRelation: "domain_events"
            referencedColumns: ["id"]
          },
        ]
      }
      bug_reports: {
        Row: {
          audio_duration_ms: number | null
          audio_file_path: string | null
          audio_transcription: string | null
          breadcrumbs: Json | null
          connection_state: Json | null
          created_at: string | null
          description: string | null
          game_state: Json | null
          id: string
          resolution_notes: string | null
          resolved_at: string | null
          resolved_by: string | null
          severity: string
          status: string | null
          title: string
          ui_state: Json | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          audio_duration_ms?: number | null
          audio_file_path?: string | null
          audio_transcription?: string | null
          breadcrumbs?: Json | null
          connection_state?: Json | null
          created_at?: string | null
          description?: string | null
          game_state?: Json | null
          id?: string
          resolution_notes?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          severity: string
          status?: string | null
          title: string
          ui_state?: Json | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          audio_duration_ms?: number | null
          audio_file_path?: string | null
          audio_transcription?: string | null
          breadcrumbs?: Json | null
          connection_state?: Json | null
          created_at?: string | null
          description?: string | null
          game_state?: Json | null
          id?: string
          resolution_notes?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          severity?: string
          status?: string | null
          title?: string
          ui_state?: Json | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      domain_events: {
        Row: {
          event_type: string
          event_version: string
          game_id: string
          id: string
          payload: Json
          player_id: string
          roll_number: number | null
          sequence_number: number
          timestamp: string
          turn_number: number | null
        }
        Insert: {
          event_type: string
          event_version?: string
          game_id: string
          id?: string
          payload: Json
          player_id: string
          roll_number?: number | null
          sequence_number: number
          timestamp?: string
          turn_number?: number | null
        }
        Update: {
          event_type?: string
          event_version?: string
          game_id?: string
          id?: string
          payload?: Json
          player_id?: string
          roll_number?: number | null
          sequence_number?: number
          timestamp?: string
          turn_number?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "domain_events_game_id_fkey"
            columns: ["game_id"]
            isOneToOne: false
            referencedRelation: "games"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "domain_events_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      feature_flags: {
        Row: {
          created_at: string
          description: string | null
          enabled: boolean
          id: string
          min_games_played: number
          premium_only: boolean
          rollout_percent: number
          updated_at: string
          user_ids: string[]
        }
        Insert: {
          created_at?: string
          description?: string | null
          enabled?: boolean
          id: string
          min_games_played?: number
          premium_only?: boolean
          rollout_percent?: number
          updated_at?: string
          user_ids?: string[]
        }
        Update: {
          created_at?: string
          description?: string | null
          enabled?: boolean
          id?: string
          min_games_played?: number
          premium_only?: boolean
          rollout_percent?: number
          updated_at?: string
          user_ids?: string[]
        }
        Relationships: []
      }
      gallery_achievements: {
        Row: {
          achievement_id: string
          created_at: string
          id: string
          progress: number
          unlocked: boolean
          unlocked_at: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          achievement_id: string
          created_at?: string
          id?: string
          progress?: number
          unlocked?: boolean
          unlocked_at?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          achievement_id?: string
          created_at?: string
          id?: string
          progress?: number
          unlocked?: boolean
          unlocked_at?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      gallery_stats: {
        Row: {
          avatar_seed: string | null
          backed_winner_count: number
          backed_winner_points: number
          best_backing_streak: number
          best_streak: number
          chat_messages: number
          chat_points: number
          correct_predictions: number
          created_at: string
          current_backing_streak: number
          current_streak: number
          display_name: string
          exact_predictions: number
          exact_score_points: number
          games_watched: number
          kibitz_points: number
          kibitz_votes: number
          loyalty_bonus_points: number
          prediction_points: number
          reaction_points: number
          reactions_given: number
          rooms_visited: number
          streak_bonus_points: number
          total_backings: number
          total_points: number
          total_predictions: number
          updated_at: string
          user_id: string
          yahtzee_predictions: number
        }
        Insert: {
          avatar_seed?: string | null
          backed_winner_count?: number
          backed_winner_points?: number
          best_backing_streak?: number
          best_streak?: number
          chat_messages?: number
          chat_points?: number
          correct_predictions?: number
          created_at?: string
          current_backing_streak?: number
          current_streak?: number
          display_name: string
          exact_predictions?: number
          exact_score_points?: number
          games_watched?: number
          kibitz_points?: number
          kibitz_votes?: number
          loyalty_bonus_points?: number
          prediction_points?: number
          reaction_points?: number
          reactions_given?: number
          rooms_visited?: number
          streak_bonus_points?: number
          total_backings?: number
          total_points?: number
          total_predictions?: number
          updated_at?: string
          user_id: string
          yahtzee_predictions?: number
        }
        Update: {
          avatar_seed?: string | null
          backed_winner_count?: number
          backed_winner_points?: number
          best_backing_streak?: number
          best_streak?: number
          chat_messages?: number
          chat_points?: number
          correct_predictions?: number
          created_at?: string
          current_backing_streak?: number
          current_streak?: number
          display_name?: string
          exact_predictions?: number
          exact_score_points?: number
          games_watched?: number
          kibitz_points?: number
          kibitz_votes?: number
          loyalty_bonus_points?: number
          prediction_points?: number
          reaction_points?: number
          reactions_given?: number
          rooms_visited?: number
          streak_bonus_points?: number
          total_backings?: number
          total_points?: number
          total_predictions?: number
          updated_at?: string
          user_id?: string
          yahtzee_predictions?: number
        }
        Relationships: []
      }
      game_players: {
        Row: {
          final_rank: number | null
          final_score: number | null
          game_id: string
          is_connected: boolean
          joined_at: string
          left_at: string | null
          scorecard: Json | null
          seat_number: number
          turn_order: number
          user_id: string
        }
        Insert: {
          final_rank?: number | null
          final_score?: number | null
          game_id: string
          is_connected?: boolean
          joined_at?: string
          left_at?: string | null
          scorecard?: Json | null
          seat_number: number
          turn_order: number
          user_id: string
        }
        Update: {
          final_rank?: number | null
          final_score?: number | null
          game_id?: string
          is_connected?: boolean
          joined_at?: string
          left_at?: string | null
          scorecard?: Json | null
          seat_number?: number
          turn_order?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "game_players_game_id_fkey"
            columns: ["game_id"]
            isOneToOne: false
            referencedRelation: "games"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "game_players_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      games: {
        Row: {
          completed_at: string | null
          created_at: string
          game_mode: string
          host_id: string | null
          id: string
          room_code: string | null
          settings: Json
          started_at: string | null
          status: string
          winner_id: string | null
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          game_mode?: string
          host_id?: string | null
          id?: string
          room_code?: string | null
          settings?: Json
          started_at?: string | null
          status?: string
          winner_id?: string | null
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          game_mode?: string
          host_id?: string | null
          id?: string
          room_code?: string | null
          settings?: Json
          started_at?: string | null
          status?: string
          winner_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "games_host_id_fkey"
            columns: ["host_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "games_winner_id_fkey"
            columns: ["winner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      player_stats: {
        Row: {
          avg_ev_loss: number
          avg_score: number
          best_score: number
          bonus_dicees: number
          category_stats: Json
          dicees_rolled: number
          games_completed: number
          games_played: number
          games_won: number
          optimal_decisions: number
          total_decisions: number
          total_score: number
          updated_at: string
          upper_bonuses: number
          user_id: string
        }
        Insert: {
          avg_ev_loss?: number
          avg_score?: number
          best_score?: number
          bonus_dicees?: number
          category_stats?: Json
          dicees_rolled?: number
          games_completed?: number
          games_played?: number
          games_won?: number
          optimal_decisions?: number
          total_decisions?: number
          total_score?: number
          updated_at?: string
          upper_bonuses?: number
          user_id: string
        }
        Update: {
          avg_ev_loss?: number
          avg_score?: number
          best_score?: number
          bonus_dicees?: number
          category_stats?: Json
          dicees_rolled?: number
          games_completed?: number
          games_played?: number
          games_won?: number
          optimal_decisions?: number
          total_decisions?: number
          total_score?: number
          updated_at?: string
          upper_bonuses?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "player_stats_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_seed: string
          avatar_style: string
          badges: Json
          bio: string | null
          created_at: string
          display_name: string | null
          id: string
          is_anonymous: boolean
          is_public: boolean
          last_seen_at: string
          preferences: Json | null
          rating_deviation: number
          rating_volatility: number
          role: Database["public"]["Enums"]["admin_role"]
          skill_rating: number
          updated_at: string
          username: string | null
        }
        Insert: {
          avatar_seed?: string
          avatar_style?: string
          badges?: Json
          bio?: string | null
          created_at?: string
          display_name?: string | null
          id: string
          is_anonymous?: boolean
          is_public?: boolean
          last_seen_at?: string
          preferences?: Json | null
          rating_deviation?: number
          rating_volatility?: number
          role?: Database["public"]["Enums"]["admin_role"]
          skill_rating?: number
          updated_at?: string
          username?: string | null
        }
        Update: {
          avatar_seed?: string
          avatar_style?: string
          badges?: Json
          bio?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          is_anonymous?: boolean
          is_public?: boolean
          last_seen_at?: string
          preferences?: Json | null
          rating_deviation?: number
          rating_volatility?: number
          role?: Database["public"]["Enums"]["admin_role"]
          skill_rating?: number
          updated_at?: string
          username?: string | null
        }
        Relationships: []
      }
      rooms: {
        Row: {
          allow_spectators: boolean | null
          code: string
          created_at: string
          created_by: string
          current_players: number
          expires_at: string
          game_id: string | null
          is_public: boolean
          max_players: number
        }
        Insert: {
          allow_spectators?: boolean | null
          code: string
          created_at?: string
          created_by: string
          current_players?: number
          expires_at?: string
          game_id?: string | null
          is_public?: boolean
          max_players?: number
        }
        Update: {
          allow_spectators?: boolean | null
          code?: string
          created_at?: string
          created_by?: string
          current_players?: number
          expires_at?: string
          game_id?: string | null
          is_public?: boolean
          max_players?: number
        }
        Relationships: [
          {
            foreignKeyName: "rooms_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rooms_game_id_fkey"
            columns: ["game_id"]
            isOneToOne: true
            referencedRelation: "games"
            referencedColumns: ["id"]
          },
        ]
      }
      solo_leaderboard: {
        Row: {
          created_at: string
          dicee_count: number | null
          efficiency: number | null
          game_id: string | null
          id: string
          score: number
          upper_bonus: boolean | null
          user_id: string
        }
        Insert: {
          created_at?: string
          dicee_count?: number | null
          efficiency?: number | null
          game_id?: string | null
          id?: string
          score: number
          upper_bonus?: boolean | null
          user_id: string
        }
        Update: {
          created_at?: string
          dicee_count?: number | null
          efficiency?: number | null
          game_id?: string | null
          id?: string
          score?: number
          upper_bonus?: boolean | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "solo_leaderboard_game_id_fkey"
            columns: ["game_id"]
            isOneToOne: false
            referencedRelation: "games"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "solo_leaderboard_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      telemetry_events: {
        Row: {
          event_type: string
          id: string
          page_url: string | null
          payload: Json
          referrer: string | null
          session_id: string
          timestamp: string
          user_agent: string | null
          user_id: string | null
        }
        Insert: {
          event_type: string
          id?: string
          page_url?: string | null
          payload: Json
          referrer?: string | null
          session_id: string
          timestamp?: string
          user_agent?: string | null
          user_id?: string | null
        }
        Update: {
          event_type?: string
          id?: string
          page_url?: string | null
          payload?: Json
          referrer?: string | null
          session_id?: string
          timestamp?: string
          user_agent?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "telemetry_events_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      gallery_leaderboard_weekly: {
        Row: {
          achievement_count: number | null
          avatar_seed: string | null
          display_name: string | null
          prediction_accuracy: number | null
          rank: number | null
          total_points: number | null
          user_id: string | null
          win_pick_ratio: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      abandon_game_atomic: {
        Args: { p_abandoned_at?: string; p_game_id: string; p_reason: string }
        Returns: Database["public"]["CompositeTypes"]["operation_result"]
        SetofOptions: {
          from: "*"
          to: "operation_result"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      aggregate_game_stats: {
        Args: { p_game_id: string }
        Returns: Database["public"]["CompositeTypes"]["stats_update_result"][]
        SetofOptions: {
          from: "*"
          to: "stats_update_result"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      award_gallery_points: {
        Args: {
          p_avatar_seed: string
          p_backed_winner?: number
          p_chat_points?: number
          p_display_name: string
          p_exact_score_points?: number
          p_kibitz_points?: number
          p_loyalty_bonus?: number
          p_prediction_points?: number
          p_reaction_points?: number
          p_streak_bonus?: number
          p_user_id: string
        }
        Returns: number
      }
      cleanup_expired_rooms: { Args: never; Returns: undefined }
      cleanup_old_analysis: { Args: never; Returns: undefined }
      cleanup_old_telemetry: { Args: never; Returns: undefined }
      complete_game_atomic: {
        Args: {
          p_completed_at?: string
          p_game_id: string
          p_rankings: Database["public"]["CompositeTypes"]["player_ranking"][]
          p_winner_id: string
        }
        Returns: Database["public"]["CompositeTypes"]["operation_result"]
        SetofOptions: {
          from: "*"
          to: "operation_result"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_game_atomic: {
        Args: {
          p_game_id: string
          p_game_mode: string
          p_host_id: string
          p_players: Database["public"]["CompositeTypes"]["game_player_input"][]
          p_room_code: string
          p_settings: Json
        }
        Returns: Database["public"]["CompositeTypes"]["operation_result"]
        SetofOptions: {
          from: "*"
          to: "operation_result"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      generate_room_code: { Args: never; Returns: string }
      get_alltime_leaderboard: {
        Args: { limit_count?: number }
        Returns: {
          avatar_seed: string
          created_at: string
          display_name: string
          efficiency: number
          rank: number
          score: number
          user_id: string
        }[]
      }
      get_daily_leaderboard: {
        Args: { limit_count?: number }
        Returns: {
          avatar_seed: string
          created_at: string
          display_name: string
          efficiency: number
          rank: number
          score: number
          user_id: string
        }[]
      }
      get_user_best_scores: {
        Args: { limit_count?: number; target_user_id: string }
        Returns: {
          created_at: string
          dicee_count: number
          efficiency: number
          score: number
          upper_bonus: boolean
        }[]
      }
      get_user_permissions: {
        Args: { user_id: string }
        Returns: {
          permission: string
        }[]
      }
      get_user_role: {
        Args: { user_id: string }
        Returns: Database["public"]["Enums"]["admin_role"]
      }
      get_weekly_leaderboard: {
        Args: { limit_count?: number }
        Returns: {
          avatar_seed: string
          created_at: string
          display_name: string
          efficiency: number
          rank: number
          score: number
          user_id: string
        }[]
      }
      has_admin_permission: {
        Args: { perm: string; user_id: string }
        Returns: boolean
      }
      log_admin_action: {
        Args: {
          p_action: string
          p_admin_id: string
          p_ip_address?: unknown
          p_metadata?: Json
          p_target_id?: string
          p_target_type?: string
          p_user_agent?: string
        }
        Returns: string
      }
      persist_domain_events: {
        Args: {
          p_events: Database["public"]["CompositeTypes"]["domain_event_input"][]
        }
        Returns: Database["public"]["CompositeTypes"]["operation_result"]
        SetofOptions: {
          from: "*"
          to: "operation_result"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      promote_to_admin: {
        Args: {
          new_role: Database["public"]["Enums"]["admin_role"]
          target_user_id: string
        }
        Returns: boolean
      }
      unlock_gallery_achievement: {
        Args: {
          p_achievement_id: string
          p_progress?: number
          p_user_id: string
        }
        Returns: boolean
      }
      update_achievement_progress: {
        Args: {
          p_achievement_id: string
          p_progress: number
          p_user_id: string
        }
        Returns: undefined
      }
      update_category_stats: {
        Args: { p_existing: Json; p_new_scorecard: Json }
        Returns: Json
      }
    }
    Enums: {
      admin_role: "user" | "moderator" | "admin" | "super_admin"
    }
    CompositeTypes: {
      domain_event_input: {
        id: string | null
        event_type: string | null
        event_version: string | null
        sequence_number: number | null
        game_id: string | null
        player_id: string | null
        turn_number: number | null
        roll_number: number | null
        payload: Json | null
      }
      game_player_input: {
        user_id: string | null
        seat_number: number | null
        turn_order: number | null
        is_ai: boolean | null
      }
      operation_result: {
        success: boolean | null
        error_code: string | null
        error_message: string | null
        affected_rows: number | null
      }
      player_ranking: {
        player_id: string | null
        rank: number | null
        score: number | null
        scorecard: Json | null
        is_ai: boolean | null
      }
      stats_update_result: {
        user_id: string | null
        games_played: number | null
        games_won: number | null
        new_badges: string[] | null
      }
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      admin_role: ["user", "moderator", "admin", "super_admin"],
    },
  },
} as const

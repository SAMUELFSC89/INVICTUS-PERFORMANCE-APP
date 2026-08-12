import { db, auth } from '../firebase';
import { doc, updateDoc, arrayUnion, getDoc, increment } from 'firebase/firestore';
import { ACHIEVEMENTS } from '../achievements';
import { notificationService } from './notificationService';

export const achievementService = {
  async checkAndAwardAchievements(userId: string, stats: { streak?: number, totalWorkouts?: number, totalActiveDays?: number }) {
    try {
      const userRef = doc(db, 'users', userId);
      const userSnap = await getDoc(userRef);
      if (!userSnap.exists()) return;

      const userData = userSnap.data();
      const currentAchievements = userData.achievements || [];
      const newAchievements: string[] = [];

      // Check Streak Achievements
      if (stats.streak !== undefined) {
        const streakMilestones = [3, 7, 15, 30, 60, 100];
        for (const milestone of streakMilestones) {
          const id = `streak_${milestone}`;
          if (stats.streak >= milestone && !currentAchievements.includes(id)) {
            newAchievements.push(id);
          }
        }
      }

      // Check Workout Achievements
      if (stats.totalWorkouts !== undefined) {
        if (stats.totalWorkouts >= 1 && !currentAchievements.includes('first_workout')) newAchievements.push('first_workout');
        if (stats.totalWorkouts >= 10 && !currentAchievements.includes('workouts_10')) newAchievements.push('workouts_10');
        if (stats.totalWorkouts >= 50 && !currentAchievements.includes('workouts_50')) newAchievements.push('workouts_50');
        if (stats.totalWorkouts >= 100 && !currentAchievements.includes('workouts_100')) newAchievements.push('workouts_100');
      }

      // Check Social Achievements
      if (userData.postsCount >= 1 && !currentAchievements.includes('first_post')) newAchievements.push('first_post');
      if (userData.followersCount >= 10 && !currentAchievements.includes('followers_10')) newAchievements.push('followers_10');
      if (userData.followersCount >= 50 && !currentAchievements.includes('followers_50')) newAchievements.push('followers_50');

      // Ranking achievements (require positions)
      if (userData.positions) {
        const { national, gym, city } = userData.positions;
        if (national === 1 && !currentAchievements.includes('champion')) newAchievements.push('champion');
        if (national <= 3 && !currentAchievements.includes('top_3')) newAchievements.push('top_3');
        if (national <= 5 && !currentAchievements.includes('top_5')) newAchievements.push('top_5');
        if (national <= 10 && !currentAchievements.includes('top_10')) newAchievements.push('top_10');
        
        if (gym === 1 && !currentAchievements.includes('gym_leader')) newAchievements.push('gym_leader');
        if (city <= 3 && !currentAchievements.includes('city_champion')) newAchievements.push('city_champion');
        if (national <= 10 && !currentAchievements.includes('national_elite')) newAchievements.push('national_elite');
      }

      // Award new achievements in a single batch update for better reliability
      if (newAchievements.length > 0) {
        let totalPoints = 0;
        newAchievements.forEach(id => {
          const a = ACHIEVEMENTS.find(ach => ach.id === id);
          if (a) totalPoints += a.points;
        });

        await updateDoc(userRef, {
          achievements: arrayUnion(...newAchievements),
          score: increment(totalPoints)
        });

        // Create individual notifications for the popups
        for (const achievementId of newAchievements) {
          const achievement = ACHIEVEMENTS.find(a => a.id === achievementId);
          if (achievement) {
            await notificationService.createNotification(
              userId,
              userId,
              'achievement',
              undefined,
              `🏆 Conquista: ${achievement.name}! +${achievement.points} XP`
            );
          }
        }
      }

      return newAchievements;
    } catch (error) {
      console.error('Error checking achievements:', error);
      return [];
    }
  }
};

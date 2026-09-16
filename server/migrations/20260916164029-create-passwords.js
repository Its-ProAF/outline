"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("passwords", {
      id: { type: Sequelize.UUID, primaryKey: true, allowNull: false },
      teamId: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: "teams", key: "id" },
        onDelete: "CASCADE",
      },
      sealed: { type: Sequelize.BLOB, allowNull: false },
      version: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 1 },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false },
    });
    await queryInterface.addIndex("passwords", ["teamId", "createdAt", "id"]);
  },
  async down(queryInterface) {
    await queryInterface.dropTable("passwords");
  },
};
